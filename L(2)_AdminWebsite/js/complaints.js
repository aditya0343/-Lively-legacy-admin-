import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  complaints: "complaints",
  residents: "residents",
  users: "users",
  properties: "properties",
  staff: "staff"
};

const COLORS = {
  navy: "#061b32",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  orange: "#e76d12",
  purple: "#7054b8",
  blue: "#4167a9",
  grey: "#e9edf5"
};

const state = {
  complaints: [],
  residents: [],
  users: [],
  properties: [],
  staff: [],
  selectedAssignProperty: "All Properties",
  selectedComplaintId: "",
  charts: {},
  savingComplaint: false,
  unsubscribers: []
};

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function isToday(value) {
  const date = toDate(value);
  if (!date) return false;

  const today = new Date();

  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "AD").trim();

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
  }, 2600);
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

/* -----------------------------
   Data Helpers
------------------------------ */

function getPropertyName(property) {
  return firstNonEmpty([property.propertyName, property.name, property.title], property.id);
}

function getPropertyOptions() {
  return state.properties
    .map((property) => ({
      id: property.id,
      name: getPropertyName(property)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getPropertyMap() {
  const map = new Map();

  state.properties.forEach((property) => {
    const name = getPropertyName(property);

    [
      property.id,
      property.propertyId,
      property.property_id,
      property.propertyCode,
      property.propertyName,
      property.name,
      name
    ].filter(Boolean).forEach((key) => {
      map.set(String(key), { id: property.id, name });
    });
  });

  return map;
}

function getResidentOptions() {
  const propertyMap = getPropertyMap();
  const map = new Map();

  state.residents.forEach((resident) => {
    const propertyId = firstNonEmpty([resident.propertyId, resident.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(resident.id, {
      id: resident.id,
      name: firstNonEmpty([resident.name, resident.fullName, resident.residentName], resident.id),
      phone: firstNonEmpty([resident.phone, resident.mobile, resident.phoneNumber], ""),
      email: firstNonEmpty([resident.email], ""),
      propertyId,
      propertyName: firstNonEmpty([resident.propertyName, resident.property], property?.name || "")
    });
  });

  state.users.forEach((user) => {
    if (map.has(user.id)) return;

    const role = normalize(user.role || user.userRole || user.type);
    const looksResident = !role || ["resident", "tenant", "student"].includes(role);

    if (!looksResident) return;

    const propertyId = firstNonEmpty([user.propertyId, user.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(user.id, {
      id: user.id,
      name: firstNonEmpty([user.name, user.fullName, user.displayName], user.id),
      phone: firstNonEmpty([user.phone, user.mobile, user.phoneNumber], ""),
      email: firstNonEmpty([user.email], ""),
      propertyId,
      propertyName: firstNonEmpty([user.propertyName, user.property], property?.name || "")
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getStaffOptions() {
  const propertyMap = getPropertyMap();
  const map = new Map();

  state.staff.forEach((staff) => {
    const propertyId = firstNonEmpty([staff.propertyId, staff.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(staff.id, {
      id: staff.id,
      name: firstNonEmpty([staff.name, staff.fullName, staff.staffName, staff.displayName], staff.id),
      phone: firstNonEmpty([staff.phone, staff.mobile], ""),
      email: firstNonEmpty([staff.email], ""),
      role: firstNonEmpty([staff.role, staff.staffRole], "Staff"),
      department: firstNonEmpty([staff.department, staff.role, staff.staffRole], "Maintenance"),
      propertyId,
      propertyName: firstNonEmpty([staff.propertyName, staff.property], property?.name || "No Property"),
      availability: firstNonEmpty(
        [staff.availability, staff.availableStatus, staff.status],
        staff.isAvailable === false ? "Unavailable" : "Available"
      ),
      isActive: staff.isActive !== false && staff.disabled !== true
    });
  });

  state.users.forEach((user) => {
    if (map.has(user.id)) return;

    const role = normalize(user.role || user.userRole || user.type);

    const looksStaff = [
      "staff",
      "maintenance",
      "plumber",
      "electrician",
      "caretaker",
      "housekeeping",
      "security"
    ].includes(role);

    if (!looksStaff) return;

    const propertyId = firstNonEmpty([user.propertyId, user.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(user.id, {
      id: user.id,
      name: firstNonEmpty([user.name, user.fullName, user.staffName, user.displayName], user.id),
      phone: firstNonEmpty([user.phone, user.mobile], ""),
      email: firstNonEmpty([user.email], ""),
      role: firstNonEmpty([user.role, user.staffRole], "Staff"),
      department: firstNonEmpty([user.department, user.role, user.staffRole], "Maintenance"),
      propertyId,
      propertyName: firstNonEmpty([user.propertyName, user.property], property?.name || "No Property"),
      availability: firstNonEmpty(
        [user.availability, user.availableStatus, user.status],
        user.isAvailable === false ? "Unavailable" : "Available"
      ),
      isActive: user.isActive !== false && user.disabled !== true
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findResident(id) {
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

function findProperty(id) {
  return getPropertyOptions().find((property) => property.id === id) || null;
}

/* -----------------------------
   Complaint Mappers
------------------------------ */

function normalizeStatus(value) {
  const clean = normalize(value);

  if (clean === "assigned") return "Assigned";
  if (clean === "in progress" || clean === "in_progress" || clean === "in-progress") return "In Progress";
  if (clean === "resolved") return "Resolved";
  if (clean === "closed") return "Closed";
  if (clean === "cancelled" || clean === "canceled") return "Cancelled";

  return "Open";
}

function normalizePriority(value) {
  const clean = normalize(value);

  if (clean === "urgent") return "Urgent";
  if (clean === "high") return "High";
  if (clean === "low") return "Low";

  return "Medium";
}

function normalizeCategory(value) {
  const clean = String(value || "").trim();
  if (!clean) return "Maintenance";

  const lower = clean.toLowerCase();

  const known = [
    "maintenance",
    "plumbing",
    "electrical",
    "food",
    "internet",
    "housekeeping",
    "payments",
    "security",
    "other"
  ];

  if (known.includes(lower)) return titleCase(lower);

  return titleCase(clean);
}

function getComplaintNo(item) {
  return firstNonEmpty([item.complaintNo, item.complaintId, item.ticketNo], item.id);
}

function getComplaintResidentId(item) {
  return firstNonEmpty([item.residentId, item.userId, item.residentDocId, item.tenantId], "");
}

function getComplaintPropertyId(item) {
  return firstNonEmpty([item.propertyId, item.property_id, item.propertyDocId], "");
}

function getComplaintPropertyName(item) {
  const propertyMap = getPropertyMap();
  const propertyId = getComplaintPropertyId(item);
  const property = propertyMap.get(propertyId);

  return firstNonEmpty([item.propertyName, item.property], property?.name || "No Property");
}

function getComplaintResidentName(item) {
  const residentId = getComplaintResidentId(item);
  const resident = getResidentOptions().find((option) => option.id === residentId);

  return firstNonEmpty([item.residentName, item.name, item.guestName, item.tenantName], resident?.name || "Resident");
}

function getComplaintPhone(item) {
  const residentId = getComplaintResidentId(item);
  const resident = getResidentOptions().find((option) => option.id === residentId);

  return firstNonEmpty([item.phone, item.mobile, item.residentPhone], resident?.phone || "");
}

function getComplaintEmail(item) {
  const residentId = getComplaintResidentId(item);
  const resident = getResidentOptions().find((option) => option.id === residentId);

  return firstNonEmpty([item.email], resident?.email || "");
}

function getComplaintRoom(item) {
  return firstNonEmpty([item.roomNo, item.roomNumber, item.bedNo, item.location, item.unit, item.flatNo], "");
}

function getComplaintCategory(item) {
  return normalizeCategory(firstNonEmpty([item.category, item.complaintCategory], "Maintenance"));
}

function getComplaintTitle(item) {
  return firstNonEmpty([item.issueTitle, item.title, item.subject], "Complaint issue");
}

function getComplaintDescription(item) {
  return firstNonEmpty([item.description, item.message, item.details], "No description added.");
}

function getComplaintPriority(item) {
  return normalizePriority(item.priority);
}

function getComplaintStatus(item) {
  return normalizeStatus(firstNonEmpty([item.status, item.complaintStatus], "Open"));
}

function getAssignedStaffId(item) {
  return firstNonEmpty([item.assignedStaffId, item.staffId], "");
}

function getAssignedStaffName(item) {
  return firstNonEmpty([item.assignedStaffName, item.staffName], "");
}

function isClosedComplaint(item) {
  const status = normalize(getComplaintStatus(item));
  return ["closed", "resolved", "cancelled", "canceled"].includes(status);
}

function isOpenComplaint(item) {
  return !isClosedComplaint(item);
}

function priorityRank(priority) {
  const clean = normalize(priority);

  if (clean === "urgent") return 4;
  if (clean === "high") return 3;
  if (clean === "medium") return 2;
  if (clean === "low") return 1;

  return 0;
}

function statusKey(status) {
  return normalize(status).replaceAll(" ", "-");
}

function chipClass(value) {
  return normalize(value).replaceAll(" ", "-");
}

/* -----------------------------
   Auth + Layout
------------------------------ */

function setupAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "../index.html";
      return;
    }

    const name = user.displayName || "Admin";
    const email = user.email || "admin@email.com";
    const initials = getInitials(name || email);

    setText("adminName", name);
    setText("dropdownAdminName", name);
    setText("dropdownAdminEmail", email);
    setText("adminAvatar", initials);
    setText("adminAvatarSmall", initials);
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.clear();
    window.location.href = "../index.html";
  });
}

function setupLayoutControls() {
  const adminApp = $("adminApp");
  const sidebar = $("sidebar");
  const menuBtn = $("menuBtn");
  const mobileOverlay = $("mobileOverlay");
  const profileBtn = $("adminProfileBtn");
  const profileDropdown = $("profileDropdown");

  if (localStorage.getItem("sidebarCollapsed") === "true") {
    adminApp?.classList.add("sidebar-collapsed");
  }

  menuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.innerWidth <= 1050) {
      sidebar?.classList.toggle("open");
      mobileOverlay?.classList.toggle("show");
    } else {
      adminApp?.classList.toggle("sidebar-collapsed");
      localStorage.setItem(
        "sidebarCollapsed",
        adminApp?.classList.contains("sidebar-collapsed") ? "true" : "false"
      );
    }
  });

  mobileOverlay?.addEventListener("click", () => {
    sidebar?.classList.remove("open");
    mobileOverlay?.classList.remove("show");
  });

  profileBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    profileDropdown?.classList.toggle("show");
  });

  profileDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", (event) => {
    const dropdownButton = event.target.closest(".nav-dropdown-btn");
    const dropdownBox = event.target.closest(".nav-dropdown");

    if (dropdownButton && dropdownBox) {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = dropdownBox.classList.contains("active");

      document.querySelectorAll(".nav-dropdown.active").forEach((item) => {
        item.classList.remove("active");
      });

      if (!isOpen) dropdownBox.classList.add("active");

      profileDropdown?.classList.remove("show");
      return;
    }

    if (!event.target.closest(".admin-profile-box")) {
      profileDropdown?.classList.remove("show");
    }

    if (!dropdownBox && !event.target.closest(".nav-submenu")) {
      document.querySelectorAll(".nav-dropdown.active").forEach((item) => {
        item.classList.remove("active");
      });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      profileDropdown?.classList.remove("show");
      document.querySelectorAll(".nav-dropdown.active").forEach((item) => {
        item.classList.remove("active");
      });
    }
  });
}

/* -----------------------------
   Firebase
------------------------------ */

function listenCollection(stateKey, collectionName) {
  const unsubscribe = onSnapshot(
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
      showToast(`${collectionName} fetch failed: ${error.message}`, "error");
    }
  );

  state.unsubscribers.push(unsubscribe);
}

function setupFirebase() {
  listenCollection("complaints", COLLECTIONS.complaints);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("staff", COLLECTIONS.staff);
}

/* -----------------------------
   Render
------------------------------ */

function renderPage() {
  renderFilterOptions();
  renderStats();
  renderCharts();
  renderComplaintList();
  renderAssignSection();
}

function renderFilterOptions() {
  const properties = [
    "All Properties",
    ...new Set(state.complaints.map(getComplaintPropertyName).filter(Boolean))
  ];

  const statuses = [
    "All Statuses",
    ...new Set(state.complaints.map(getComplaintStatus).filter(Boolean))
  ];

  const priorities = [
    "All Priorities",
    ...new Set(state.complaints.map(getComplaintPriority).filter(Boolean))
  ];

  const categories = [
    "All Categories",
    ...new Set(state.complaints.map(getComplaintCategory).filter(Boolean))
  ];

  updateSelect("propertyFilter", properties);
  updateSelect("statusFilter", statuses);
  updateSelect("priorityFilter", priorities);
  updateSelect("categoryFilter", categories);
  updateSelect("assignPropertyFilter", properties);

  const assignSelect = $("assignPropertyFilter");
  if (assignSelect && assignSelect.value !== state.selectedAssignProperty) {
    assignSelect.value = properties.includes(state.selectedAssignProperty)
      ? state.selectedAssignProperty
      : "All Properties";

    state.selectedAssignProperty = assignSelect.value;
  }
}

function updateSelect(id, values) {
  const select = $(id);
  if (!select) return;

  const current = select.value;
  const uniqueValues = [...new Set(values.filter(Boolean))];

  select.innerHTML = uniqueValues
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");

  select.value = uniqueValues.includes(current) ? current : uniqueValues[0];
}

function getSummary() {
  const open = state.complaints.filter(isOpenComplaint);
  const unassigned = open.filter((item) => !getAssignedStaffId(item));
  const assignedToday = open.filter((item) => {
    return getAssignedStaffId(item) && isToday(item.assignedAt || item.updatedAt || item.createdAt);
  });
  const urgent = open.filter((item) => getComplaintPriority(item) === "Urgent");

  return {
    openCount: open.length,
    unassignedCount: unassigned.length,
    assignedTodayCount: assignedToday.length,
    urgentCount: urgent.length
  };
}

function renderStats() {
  const summary = getSummary();

  setText("openComplaintsValue", summary.openCount);
  setText("unassignedValue", summary.unassignedCount);
  setText("assignedTodayValue", summary.assignedTodayCount);
  setText("urgentPriorityValue", summary.urgentCount);
}

/* Charts */

function createChart(id, config) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return;

  if (state.charts[id]) {
    state.charts[id].data = config.data;
    state.charts[id].options = config.options;
    state.charts[id].update();
    return;
  }

  state.charts[id] = new Chart(canvas, config);
}

function renderCharts() {
  renderStatusChart();
  renderPriorityBars();
  renderCategoryBars();
  renderAssignmentBars();
}

function renderStatusChart() {
  const totals = countBy(state.complaints, getComplaintStatus);
  const labels = Object.keys(totals);
  const values = Object.values(totals);
  const total = values.reduce((sum, value) => sum + value, 0);

  const colorMap = {
    Open: COLORS.blue,
    Assigned: COLORS.gold,
    "In Progress": COLORS.purple,
    Resolved: COLORS.green,
    Closed: COLORS.navy,
    Cancelled: COLORS.red
  };

  setText("statusChartCenter", String(total || 0));

  createChart("statusChart", {
    type: "doughnut",
    data: {
      labels: total ? labels : ["No Data"],
      datasets: [
        {
          data: total ? values : [1],
          backgroundColor: total ? labels.map((label) => colorMap[label] || COLORS.navy) : [COLORS.grey],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: { display: false }
      }
    }
  });

  const legend = $("statusLegend");
  if (!legend) return;

  if (!total) {
    legend.innerHTML = `<div class="empty-state small">No complaint chart data yet.</div>`;
    return;
  }

  legend.innerHTML = labels.map((label) => {
    const value = totals[label] || 0;
    const percentage = total ? Math.round((value / total) * 100) : 0;

    return `
      <div class="legend-row">
        <span>
          <i class="legend-dot" style="background:${colorMap[label] || COLORS.navy}"></i>
          ${escapeHtml(label)}
        </span>
        <strong>${percentage}%</strong>
      </div>
    `;
  }).join("");
}

function renderPriorityBars() {
  const totals = {
    Urgent: 0,
    High: 0,
    Medium: 0,
    Low: 0
  };

  state.complaints.forEach((item) => {
    const key = getComplaintPriority(item);
    totals[key] = (totals[key] || 0) + 1;
  });

  renderBars("priorityBars", totals, {
    Urgent: COLORS.red,
    High: COLORS.orange,
    Medium: COLORS.gold,
    Low: COLORS.green
  });
}

function renderCategoryBars() {
  const totals = countBy(state.complaints, getComplaintCategory);
  renderBars("categoryBars", totals, {});
}

function renderAssignmentBars() {
  const totals = {
    "Open Assigned": 0,
    "Open Unassigned": 0,
    "Closed / Resolved": 0
  };

  state.complaints.forEach((item) => {
    if (isClosedComplaint(item)) {
      totals["Closed / Resolved"] += 1;
      return;
    }

    if (getAssignedStaffId(item)) {
      totals["Open Assigned"] += 1;
    } else {
      totals["Open Unassigned"] += 1;
    }
  });

  renderBars("assignmentBars", totals, {
    "Open Assigned": COLORS.green,
    "Open Unassigned": COLORS.orange,
    "Closed / Resolved": COLORS.navy
  });
}

function countBy(items, getter) {
  const totals = {};

  items.forEach((item) => {
    const key = getter(item);
    totals[key] = (totals[key] || 0) + 1;
  });

  return totals;
}

function renderBars(id, totals, colorMap = {}) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const maxValue = Math.max(...entries.map((entry) => entry[1]), 0);
  const defaultColors = [COLORS.blue, COLORS.gold, COLORS.purple, COLORS.green, COLORS.orange, COLORS.red, COLORS.navy];

  if (!maxValue) {
    container.innerHTML = `<div class="empty-state small">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value], index) => {
    const width = maxValue ? Math.round((value / maxValue) * 100) : 0;
    const color = colorMap[label] || defaultColors[index % defaultColors.length];

    return `
      <div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color}"></div>
        </div>
        <strong>${value}</strong>
      </div>
    `;
  }).join("");
}

/* Complaint List */

function getFilteredComplaints() {
  let items = [...state.complaints];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("complaintSearchInput")?.value);
  const search = localSearch || globalSearch;

  const propertyFilter = $("propertyFilter")?.value || "All Properties";
  const statusFilter = $("statusFilter")?.value || "All Statuses";
  const priorityFilter = $("priorityFilter")?.value || "All Priorities";
  const categoryFilter = $("categoryFilter")?.value || "All Categories";

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        getComplaintNo(item),
        getComplaintResidentName(item),
        getComplaintPhone(item),
        getComplaintPropertyName(item),
        getComplaintTitle(item),
        getComplaintCategory(item),
        getComplaintPriority(item),
        getComplaintStatus(item)
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (propertyFilter !== "All Properties") {
    items = items.filter((item) => getComplaintPropertyName(item) === propertyFilter);
  }

  if (statusFilter !== "All Statuses") {
    items = items.filter((item) => getComplaintStatus(item) === statusFilter);
  }

  if (priorityFilter !== "All Priorities") {
    items = items.filter((item) => getComplaintPriority(item) === priorityFilter);
  }

  if (categoryFilter !== "All Categories") {
    items = items.filter((item) => getComplaintCategory(item) === categoryFilter);
  }

  items.sort((a, b) => {
    const priorityA = priorityRank(getComplaintPriority(a));
    const priorityB = priorityRank(getComplaintPriority(b));

    if (priorityA !== priorityB) return priorityB - priorityA;

    const dateA = toDate(a.createdAt || a.date) || new Date(1900, 0, 1);
    const dateB = toDate(b.createdAt || b.date) || new Date(1900, 0, 1);

    return dateB - dateA;
  });

  return items;
}

function renderComplaintList() {
  const container = $("complaintList");
  if (!container) return;

  const complaints = getFilteredComplaints();

  setText("complaintListSubText", `${complaints.length} complaint records shown`);

  if (!complaints.length) {
    container.innerHTML = `<div class="empty-state">No complaints found.</div>`;
    return;
  }

  container.innerHTML = complaints.map((item) => {
    const name = getComplaintResidentName(item);
    const phone = getComplaintPhone(item);
    const priority = getComplaintPriority(item);
    const status = getComplaintStatus(item);

    return `
      <article class="complaint-row-card">
        <div class="avatar-box">${escapeHtml(getInitials(name))}</div>

        <div class="row-text">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(phone || "No phone")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getComplaintNo(item))}</strong>
          <span>${escapeHtml(getComplaintPropertyName(item))}</span>
        </div>

        <div class="row-text">
          <strong>${escapeHtml(getComplaintTitle(item))}</strong>
          <span>${escapeHtml(getComplaintCategory(item))} • ${escapeHtml(formatDate(item.createdAt || item.date))}</span>
        </div>

        <span class="tiny-chip ${chipClass(priority)} desktop-col">${escapeHtml(priority)}</span>
        <span class="tiny-chip ${chipClass(status)}">${escapeHtml(status)}</span>

        <div class="row-actions">
          <button type="button" title="View Details" data-view-complaint="${escapeHtml(item.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <select data-status-complaint="${escapeHtml(item.id)}" title="Change Status">
            ${["Open", "Assigned", "In Progress", "Resolved", "Closed"].map((option) => `
              <option value="${option}" ${status === option ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

/* Assign Section */

function getAssignmentComplaints() {
  let items = state.complaints.filter((item) => {
    const isClosed = isClosedComplaint(item);
    const isAssigned = Boolean(getAssignedStaffId(item));
    const matchesProperty =
      state.selectedAssignProperty === "All Properties" ||
      getComplaintPropertyName(item) === state.selectedAssignProperty;

    return !isClosed && !isAssigned && matchesProperty;
  });

  items.sort((a, b) => {
    const priorityA = priorityRank(getComplaintPriority(a));
    const priorityB = priorityRank(getComplaintPriority(b));

    if (priorityA !== priorityB) return priorityB - priorityA;

    const dateA = toDate(a.createdAt || a.date) || new Date(2200, 0, 1);
    const dateB = toDate(b.createdAt || b.date) || new Date(2200, 0, 1);

    return dateA - dateB;
  });

  return items;
}

function renderAssignSection() {
  renderAssignComplaints();
  renderAssignStaff();
}

function renderAssignComplaints() {
  const container = $("assignComplaintList");
  if (!container) return;

  const complaints = getAssignmentComplaints();

  if (!complaints.length) {
    container.innerHTML = `<div class="empty-state small">No unassigned complaints found.</div>`;
    state.selectedComplaintId = "";
    renderAssignStaff();
    return;
  }

  if (!state.selectedComplaintId || !complaints.some((item) => item.id === state.selectedComplaintId)) {
    state.selectedComplaintId = complaints[0].id;
  }

  container.innerHTML = complaints.map((item) => {
    const selected = item.id === state.selectedComplaintId ? "active" : "";
    const priority = getComplaintPriority(item);

    return `
      <div class="assign-card-item ${selected}" data-select-complaint="${escapeHtml(item.id)}">
        <i class="fa-solid ${selected ? "fa-circle-dot" : "fa-circle"} assign-radio"></i>

        <div class="row-text">
          <strong>${escapeHtml(getComplaintTitle(item))}</strong>
          <span>${escapeHtml(getComplaintNo(item))} • ${escapeHtml(getComplaintResidentName(item))}</span>
        </div>

        <span class="tiny-chip ${chipClass(priority)}">${escapeHtml(priority)}</span>
      </div>
    `;
  }).join("");
}

function renderAssignStaff() {
  const container = $("assignStaffList");
  const title = $("availableStaffTitle");

  if (!container) return;

  const selectedComplaint = state.complaints.find((item) => item.id === state.selectedComplaintId);

  if (!selectedComplaint) {
    container.innerHTML = `<div class="empty-state small">Select one complaint to see matching staff.</div>`;
    if (title) title.textContent = "Available Staff";
    return;
  }

  const complaintPropertyId = getComplaintPropertyId(selectedComplaint);
  const complaintPropertyName = getComplaintPropertyName(selectedComplaint);

  if (title) title.textContent = `Available Staff in ${complaintPropertyName}`;

  const staff = getStaffOptions().filter((staffMember) => {
    if (!staffMember.isActive) return false;

    const sameProperty =
      staffMember.propertyId === complaintPropertyId ||
      staffMember.propertyName === complaintPropertyName;

    return sameProperty;
  });

  if (!staff.length) {
    container.innerHTML = `
      <div class="empty-state small">
        No staff found. Add staff with same propertyId/propertyName to assign complaints.
      </div>
    `;
    return;
  }

  container.innerHTML = staff.map((staffMember) => {
    const available = normalize(staffMember.availability).includes("available");

    return `
      <div class="staff-card-item">
        <div class="staff-avatar">${escapeHtml(getInitials(staffMember.name))}</div>

        <div class="row-text">
          <strong>${escapeHtml(staffMember.name)}</strong>
          <span>${escapeHtml(staffMember.role)} • ${escapeHtml(staffMember.department)} • ${escapeHtml(staffMember.availability)}</span>
        </div>

        <button
          class="assign-staff-btn"
          type="button"
          data-assign-staff="${escapeHtml(staffMember.id)}"
          ${available ? "" : "disabled"}
        >
          Assign
        </button>
      </div>
    `;
  }).join("");
}

async function assignStaff(staffId) {
  const complaint = state.complaints.find((item) => item.id === state.selectedComplaintId);
  const staff = getStaffOptions().find((item) => item.id === staffId);

  if (!complaint) {
    showToast("Select a complaint first.", "error");
    return;
  }

  if (!staff) {
    showToast("Selected staff not found.", "error");
    return;
  }

  try {
    await setDoc(
      doc(db, COLLECTIONS.complaints, complaint.id),
      {
        assignedStaffId: staff.id,
        assignedStaffName: staff.name,
        assignedStaffPhone: staff.phone,
        assignedStaffRole: staff.role,
        assignedStaffDepartment: staff.department,
        assignedAt: serverTimestamp(),
        status: getComplaintStatus(complaint) === "Open" ? "Assigned" : getComplaintStatus(complaint),
        complaintStatus: getComplaintStatus(complaint) === "Open" ? "Assigned" : getComplaintStatus(complaint),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    state.selectedComplaintId = "";
    showToast(`${staff.name} assigned to ${getComplaintNo(complaint)}.`);
  } catch (error) {
    console.error("Assign staff failed:", error);
    showToast(`Failed to assign staff: ${error.message}`, "error");
  }
}

/* Status + Details */

async function updateComplaintStatus(id, status) {
  try {
    const data = {
      status,
      complaintStatus: status,
      updatedAt: serverTimestamp()
    };

    if (status === "Resolved") data.resolvedAt = serverTimestamp();
    if (status === "Closed") data.closedAt = serverTimestamp();

    await setDoc(doc(db, COLLECTIONS.complaints, id), data, { merge: true });

    showToast("Complaint status updated.");
  } catch (error) {
    console.error("Status update failed:", error);
    showToast(`Failed to update complaint: ${error.message}`, "error");
  }
}

function openComplaintDetail(id) {
  const complaint = state.complaints.find((item) => item.id === id);
  if (!complaint) return;

  const no = getComplaintNo(complaint);
  const title = getComplaintTitle(complaint);
  const status = getComplaintStatus(complaint);
  const priority = getComplaintPriority(complaint);

  setText("detailComplaintNo", no);
  setText("detailComplaintTitle", title);

  const content = $("complaintDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="detail-grid">
      <div class="detail-line">
        <span>Resident</span>
        <strong>${escapeHtml(getComplaintResidentName(complaint))}</strong>
      </div>

      <div class="detail-line">
        <span>Phone</span>
        <strong>${escapeHtml(getComplaintPhone(complaint) || "-")}</strong>
      </div>

      <div class="detail-line">
        <span>Email</span>
        <strong>${escapeHtml(getComplaintEmail(complaint) || "-")}</strong>
      </div>

      <div class="detail-line">
        <span>Property</span>
        <strong>${escapeHtml(getComplaintPropertyName(complaint))}</strong>
      </div>

      <div class="detail-line">
        <span>Room / Location</span>
        <strong>${escapeHtml(getComplaintRoom(complaint) || "-")}</strong>
      </div>

      <div class="detail-line">
        <span>Category</span>
        <strong>${escapeHtml(getComplaintCategory(complaint))}</strong>
      </div>

      <div class="detail-line">
        <span>Priority</span>
        <strong>${escapeHtml(priority)}</strong>
      </div>

      <div class="detail-line">
        <span>Status</span>
        <strong>${escapeHtml(status)}</strong>
      </div>

      <div class="detail-line">
        <span>Created</span>
        <strong>${escapeHtml(formatDate(complaint.createdAt || complaint.date))}</strong>
      </div>

      <div class="detail-line">
        <span>Assigned Staff</span>
        <strong>${escapeHtml(getAssignedStaffName(complaint) || "Not Assigned")}</strong>
      </div>
    </div>

    <div class="detail-description">
      ${escapeHtml(getComplaintDescription(complaint))}
    </div>

    <div class="detail-status-actions">
      <button class="gold-action" type="button" data-detail-status="${escapeHtml(id)}" data-status-value="In Progress">
        In Progress
      </button>

      <button class="green-action" type="button" data-detail-status="${escapeHtml(id)}" data-status-value="Resolved">
        Resolved
      </button>

      <button class="red-action" type="button" data-detail-status="${escapeHtml(id)}" data-status-value="Closed">
        Closed
      </button>
    </div>
  `;

  openModal("complaintDetailModal");
}

/* Add Complaint */

function fillSelect(selectId, options, placeholder) {
  const select = $(selectId);
  if (!select) return;

  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;

  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.label;
    select.appendChild(item);
  });
}

function resetAddComplaintForm() {
  $("addComplaintForm")?.reset();

  const residents = getResidentOptions();
  const properties = getPropertyOptions();

  fillSelect(
    "complaintResidentInput",
    residents.map((resident) => ({
      id: resident.id,
      label: `${resident.name}${resident.phone ? ` • ${resident.phone}` : ""}`
    })),
    "Select resident"
  );

  fillSelect(
    "complaintPropertyInput",
    properties.map((property) => ({
      id: property.id,
      label: property.name
    })),
    "Select property"
  );

  $("complaintCategoryInput").value = "Maintenance";
  $("complaintPriorityInput").value = "Medium";
}

async function saveComplaint(event) {
  event.preventDefault();

  if (state.savingComplaint) return;

  const form = $("addComplaintForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const residentId = $("complaintResidentInput").value;
  const propertyId = $("complaintPropertyInput").value;
  const resident = findResident(residentId);
  const property = findProperty(propertyId);

  if (!resident || !property) {
    showToast("Selected resident or property not found.", "error");
    return;
  }

  state.savingComplaint = true;
  $("saveComplaintBtn").disabled = true;
  $("saveComplaintBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const ref = doc(collection(db, COLLECTIONS.complaints));
    const complaintNo = `CMP-${ref.id.slice(0, 6).toUpperCase()}`;

    const issueTitle = $("complaintTitleInput").value.trim();
    const description = $("complaintDescriptionInput").value.trim();

    await setDoc(ref, {
      complaintId: ref.id,
      complaintNo,
      residentId: resident.id,
      userId: resident.id,
      residentName: resident.name,
      name: resident.name,
      phone: resident.phone,
      email: resident.email,
      propertyId: property.id,
      propertyName: property.name,
      roomNo: $("complaintRoomInput").value.trim(),
      category: $("complaintCategoryInput").value,
      issueTitle,
      title: issueTitle,
      description,
      priority: $("complaintPriorityInput").value,
      status: "Open",
      complaintStatus: "Open",
      assignedStaffId: "",
      assignedStaffName: "",
      assignedStaffPhone: "",
      assignedStaffRole: "",
      source: "admin_website",
      createdBy: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Complaint created successfully.");
    closeModal("addComplaintModal");
  } catch (error) {
    console.error("Complaint save failed:", error);
    showToast(`Failed to create complaint: ${error.message}`, "error");
  } finally {
    state.savingComplaint = false;
    $("saveComplaintBtn").disabled = false;
    $("saveComplaintBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Complaint`;
  }
}

/* Modal */

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

/* Events */

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Complaints refreshed.");
  });

  $("openAddComplaintBtn")?.addEventListener("click", () => {
    resetAddComplaintForm();
    openModal("addComplaintModal");
  });

  $("addComplaintForm")?.addEventListener("submit", saveComplaint);

  $("complaintResidentInput")?.addEventListener("change", () => {
    const resident = findResident($("complaintResidentInput").value);

    if (resident && resident.propertyId) {
      $("complaintPropertyInput").value = resident.propertyId;
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(button.dataset.closeModal);
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  [
    "globalSearchInput",
    "complaintSearchInput",
    "propertyFilter",
    "statusFilter",
    "priorityFilter",
    "categoryFilter"
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", renderComplaintList);
    element.addEventListener("change", renderComplaintList);
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("complaintSearchInput").value = "";
    $("propertyFilter").value = "All Properties";
    $("statusFilter").value = "All Statuses";
    $("priorityFilter").value = "All Priorities";
    $("categoryFilter").value = "All Categories";

    renderComplaintList();
  });

  $("assignPropertyFilter")?.addEventListener("change", () => {
    state.selectedAssignProperty = $("assignPropertyFilter").value;
    state.selectedComplaintId = "";
    renderAssignSection();
  });

  $("complaintList")?.addEventListener("click", (event) => {
    const viewBtn = event.target.closest("[data-view-complaint]");
    if (!viewBtn) return;

    openComplaintDetail(viewBtn.dataset.viewComplaint);
  });

  $("complaintList")?.addEventListener("change", (event) => {
    const statusSelect = event.target.closest("[data-status-complaint]");
    if (!statusSelect) return;

    updateComplaintStatus(statusSelect.dataset.statusComplaint, statusSelect.value);
  });

  $("assignComplaintList")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-select-complaint]");
    if (!item) return;

    state.selectedComplaintId = item.dataset.selectComplaint;
    renderAssignSection();
  });

  $("assignStaffList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-assign-staff]");
    if (!button) return;

    assignStaff(button.dataset.assignStaff);
  });

  $("complaintDetailContent")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail-status]");
    if (!button) return;

    updateComplaintStatus(button.dataset.detailStatus, button.dataset.statusValue);
    closeModal("complaintDetailModal");
  });
}

/* Init */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});