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
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  visitors: "visitors",
  residents: "residents",
  users: "users",
  properties: "properties"
};

const COLORS = {
  navy: "#061b32",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  orange: "#e18a00",
  purple: "#6352c7",
  blue: "#2f80ed",
  grey: "#e9edf5"
};

const VISITOR_STATUSES = [
  "Pending",
  "Accepted",
  "Rejected",
  "Checked In",
  "Checked Out",
  "Restricted"
];

const VISITOR_PURPOSES = [
  "Personal Visit",
  "Family Visit",
  "Friend Visit",
  "Delivery",
  "Maintenance",
  "Interview",
  "Official Visit",
  "Other"
];

const VISITOR_PROOF_TYPES = [
  "Aadhaar",
  "PAN",
  "Voter ID",
  "Driving License",
  "Passport",
  "Other"
];

const state = {
  visitors: [],
  residents: [],
  users: [],
  properties: [],
  charts: {},
  savingVisitor: false,
  unsubscribers: []
};

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
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

function titleCase(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";

  return clean
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function toDate(value) {
  if (!value) return null;

  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function formatShortDate(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  });
}

function dateInputValue(value = new Date()) {
  const date = toDate(value) || new Date();
  return date.toISOString().slice(0, 10);
}

function timeInputValue(value = new Date()) {
  const date = toDate(value) || new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function fromDateAndTime(dateValue, timeValue) {
  const date = dateValue || dateInputValue(new Date());
  const time = timeValue || timeInputValue(new Date());

  const merged = new Date(`${date}T${time}:00`);
  return Number.isNaN(merged.getTime()) ? new Date() : merged;
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "NA").trim();

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

/* -----------------------------
   Property + Resident Helpers
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

function findProperty(id) {
  return getPropertyOptions().find((property) => property.id === id) || null;
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
      phone: firstNonEmpty([resident.phone, resident.mobile], ""),
      email: firstNonEmpty([resident.email], ""),
      roomNo: firstNonEmpty([resident.roomNo, resident.roomNumber, resident.bedNo], ""),
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
      phone: firstNonEmpty([user.phone, user.mobile], ""),
      email: firstNonEmpty([user.email], ""),
      roomNo: firstNonEmpty([user.roomNo, user.roomNumber, user.bedNo], ""),
      propertyId,
      propertyName: firstNonEmpty([user.propertyName, user.property], property?.name || "")
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findResident(id) {
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

/* -----------------------------
   Visitor Mappers
------------------------------ */

function normalizeVisitorStatus(value) {
  const clean = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (clean === "accepted" || clean === "approved") return "Accepted";
  if (clean === "rejected" || clean === "declined") return "Rejected";
  if (clean === "checked in") return "Checked In";
  if (clean === "checked out") return "Checked Out";
  if (clean === "restricted" || clean === "blocked") return "Restricted";

  return "Pending";
}

function normalizePurpose(value) {
  const clean = String(value || "").trim();
  if (!clean) return "Personal Visit";

  const lower = clean.toLowerCase();

  if (lower === "personal visit") return "Personal Visit";
  if (lower === "family visit") return "Family Visit";
  if (lower === "friend visit") return "Friend Visit";
  if (lower === "delivery") return "Delivery";
  if (lower === "maintenance") return "Maintenance";
  if (lower === "interview") return "Interview";
  if (lower === "official visit") return "Official Visit";
  if (lower === "other") return "Other";

  return titleCase(clean);
}

function getVisitorNo(visitor) {
  return firstNonEmpty([visitor.visitorNo, visitor.visitorId, visitor.requestNo], visitor.id);
}

function getGuestName(visitor) {
  return firstNonEmpty([visitor.guestName, visitor.visitorName, visitor.name], "Guest");
}

function getGuestPhone(visitor) {
  return firstNonEmpty([visitor.guestPhone, visitor.phone, visitor.mobile], "");
}

function getGuestEmail(visitor) {
  return firstNonEmpty([visitor.guestEmail, visitor.email], "");
}

function getGuestProofType(visitor) {
  return firstNonEmpty([visitor.guestIdProofType, visitor.idProofType], "Not Added");
}

function getGuestProofNumber(visitor) {
  return firstNonEmpty([visitor.guestIdProofNumber, visitor.idProofNumber], "");
}

function getVehicleNumber(visitor) {
  return firstNonEmpty([visitor.vehicleNumber], "");
}

function getRequestedById(visitor) {
  return firstNonEmpty([visitor.requestedById, visitor.residentId, visitor.userId, visitor.tenantId], "");
}

function getRequestedResident(visitor) {
  const id = getRequestedById(visitor);
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

function getRequestedByName(visitor) {
  const resident = getRequestedResident(visitor);

  return firstNonEmpty(
    [visitor.requestedByName, visitor.residentName, visitor.hostName, visitor.requestedBy],
    resident?.name || "Resident"
  );
}

function getRequestedByPhone(visitor) {
  const resident = getRequestedResident(visitor);

  return firstNonEmpty(
    [visitor.requestedByPhone, visitor.residentPhone],
    resident?.phone || ""
  );
}

function getRequestedByRoom(visitor) {
  const resident = getRequestedResident(visitor);

  return firstNonEmpty(
    [visitor.requestedByRoom, visitor.residentRoom, visitor.roomNo, visitor.roomNumber],
    resident?.roomNo || ""
  );
}

function getVisitorPropertyId(visitor) {
  return firstNonEmpty([visitor.propertyId, visitor.property_id, visitor.propertyDocId], "");
}

function getVisitorPropertyName(visitor) {
  const propertyMap = getPropertyMap();
  const resident = getRequestedResident(visitor);
  const propertyId = getVisitorPropertyId(visitor);
  const property = propertyMap.get(propertyId);

  return firstNonEmpty(
    [visitor.propertyName, visitor.property],
    property?.name || resident?.propertyName || "No Property"
  );
}

function getVisitorPurpose(visitor) {
  return normalizePurpose(firstNonEmpty([visitor.purpose, visitor.visitPurpose], "Personal Visit"));
}

function getVisitorStatus(visitor) {
  return normalizeVisitorStatus(firstNonEmpty([visitor.status, visitor.visitorStatus], "Pending"));
}

function getVisitorNotes(visitor) {
  return firstNonEmpty([visitor.notes, visitor.message], "");
}

function getVisitorSource(visitor) {
  return firstNonEmpty([visitor.source], "admin_app");
}

function getVisitDateTime(visitor) {
  return firstNonEmpty([visitor.visitDateTime, visitor.visitTime, visitor.timeOfVisit, visitor.scheduledAt, visitor.createdAt], "");
}

function getCreatedAt(visitor) {
  return visitor.createdAt || null;
}

function statusClass(value) {
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
  listenCollection("visitors", COLLECTIONS.visitors);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
}

/* -----------------------------
   Render
------------------------------ */

function renderPage() {
  renderFilterOptions();
  renderStats();
  renderCharts();
  renderVisitorList();
  renderVisitorOverview();
}

function updateSelect(id, values) {
  const select = $(id);
  if (!select) return;

  const current = select.value;
  const unique = [...new Set(values.filter(Boolean))];

  select.innerHTML = unique
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");

  select.value = unique.includes(current) ? current : unique[0];
}

function renderFilterOptions() {
  const properties = [
    "All Properties",
    ...new Set(state.visitors.map(getVisitorPropertyName).filter(Boolean))
  ];

  const statuses = [
    "All Status",
    ...new Set(state.visitors.map(getVisitorStatus).filter(Boolean))
  ];

  const purposes = [
    "All Purpose",
    ...new Set(state.visitors.map(getVisitorPurpose).filter(Boolean))
  ];

  updateSelect("propertyFilter", properties);
  updateSelect("statusFilter", statuses);
  updateSelect("purposeFilter", purposes);
}

function getSummary() {
  const totalVisitors = state.visitors.length;
  const pendingRequests = state.visitors.filter((item) => getVisitorStatus(item) === "Pending").length;
  const acceptedRequests = state.visitors.filter((item) => getVisitorStatus(item) === "Accepted").length;
  const checkedIn = state.visitors.filter((item) => getVisitorStatus(item) === "Checked In").length;
  const checkedOut = state.visitors.filter((item) => getVisitorStatus(item) === "Checked Out").length;
  const restricted = state.visitors.filter((item) => getVisitorStatus(item) === "Restricted").length;

  return {
    totalVisitors,
    pendingRequests,
    acceptedRequests,
    checkedIn,
    checkedOut,
    restricted
  };
}

function renderStats() {
  const summary = getSummary();

  setText("totalVisitorsValue", summary.totalVisitors);
  setText("pendingRequestsValue", summary.pendingRequests);
  setText("acceptedRequestsValue", summary.acceptedRequests);
  setText("checkedInValue", summary.checkedIn);
  setText("checkedOutValue", summary.checkedOut);
  setText("restrictedValue", summary.restricted);
}

function countBy(items, getter) {
  const result = {};

  items.forEach((item) => {
    const key = getter(item);
    result[key] = (result[key] || 0) + 1;
  });

  return result;
}

function renderCharts() {
  renderStatusChart(countBy(state.visitors, getVisitorStatus));
  renderBars("purposeBars", countBy(state.visitors, getVisitorPurpose), paletteColor);
  renderBars("propertyBars", countBy(state.visitors, getVisitorPropertyName), paletteColor);
  renderTrendChart();
}

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

function renderStatusChart(map) {
  const labels = Object.keys(map);
  const values = Object.values(map);
  const total = values.reduce((sum, value) => sum + value, 0);

  setText("statusChartCenter", total || 0);

  createChart("statusChart", {
    type: "doughnut",
    data: {
      labels: total ? labels : ["No Data"],
      datasets: [
        {
          data: total ? values : [1],
          backgroundColor: total ? labels.map(statusColor) : [COLORS.grey],
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
    legend.innerHTML = `<div class="empty-state small">No visitor status data yet.</div>`;
    return;
  }

  legend.innerHTML = labels.map((label) => {
    return `
      <div class="legend-row">
        <span>
          <i class="legend-dot" style="background:${statusColor(label)}"></i>
          ${escapeHtml(label)}
        </span>
        <strong>${map[label]}</strong>
      </div>
    `;
  }).join("");
}

function renderBars(id, map, colorGetter) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(map)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const maxValue = Math.max(...entries.map((item) => item[1]), 0);

  if (!entries.length || !maxValue) {
    container.innerHTML = `<div class="empty-state small">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value], index) => {
    const width = Math.round((value / maxValue) * 100);
    const color = colorGetter(label, index);

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

function renderTrendChart() {
  const container = $("trendChart");
  if (!container) return;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const points = [];

  for (let index = 6; index >= 0; index--) {
    const day = new Date(start);
    day.setDate(start.getDate() - index);

    const key = trendKey(day);

    points.push({
      key,
      label: formatShortDate(day),
      count: 0
    });
  }

  state.visitors.forEach((visitor) => {
    const date = toDate(getVisitDateTime(visitor)) || toDate(getCreatedAt(visitor));
    if (!date) return;

    const key = trendKey(date);
    const point = points.find((item) => item.key === key);
    if (point) point.count += 1;
  });

  const maxValue = Math.max(...points.map((item) => item.count), 0);

  container.innerHTML = points.map((item) => {
    const height = maxValue ? 26 + Math.round((item.count / maxValue) * 104) : 26;

    return `
      <div class="trend-item">
        <div class="trend-count">${item.count}</div>
        <div class="trend-bar" style="height:${height}px"></div>
        <div class="trend-label">${escapeHtml(item.label)}</div>
      </div>
    `;
  }).join("");
}

function trendKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* -----------------------------
   Visitor List
------------------------------ */

function getFilteredVisitors() {
  let visitors = [...state.visitors];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("visitorSearchInput")?.value);
  const search = localSearch || globalSearch;

  const propertyFilter = $("propertyFilter")?.value || "All Properties";
  const statusFilter = $("statusFilter")?.value || "All Status";
  const purposeFilter = $("purposeFilter")?.value || "All Purpose";
  const sortFilter = $("sortFilter")?.value || "Recently Added";

  if (search) {
    visitors = visitors.filter((visitor) => {
      const haystack = [
        getVisitorNo(visitor),
        getGuestName(visitor),
        getGuestPhone(visitor),
        getGuestEmail(visitor),
        getRequestedByName(visitor),
        getRequestedByPhone(visitor),
        getRequestedByRoom(visitor),
        getVisitorPropertyName(visitor),
        getVisitorPurpose(visitor),
        getVisitorStatus(visitor),
        formatDateTime(getVisitDateTime(visitor))
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (propertyFilter !== "All Properties") {
    visitors = visitors.filter((visitor) => getVisitorPropertyName(visitor) === propertyFilter);
  }

  if (statusFilter !== "All Status") {
    visitors = visitors.filter((visitor) => getVisitorStatus(visitor) === statusFilter);
  }

  if (purposeFilter !== "All Purpose") {
    visitors = visitors.filter((visitor) => getVisitorPurpose(visitor) === purposeFilter);
  }

  visitors.sort((a, b) => {
    if (sortFilter === "Guest A-Z") {
      return getGuestName(a).localeCompare(getGuestName(b));
    }

    if (sortFilter === "Visit Time") {
      const aTime = toDate(getVisitDateTime(a))?.getTime() || 2200000000000;
      const bTime = toDate(getVisitDateTime(b))?.getTime() || 2200000000000;
      return aTime - bTime;
    }

    if (sortFilter === "Status") {
      return getVisitorStatus(a).localeCompare(getVisitorStatus(b));
    }

    const aCreated = toDate(getCreatedAt(a))?.getTime() || 0;
    const bCreated = toDate(getCreatedAt(b))?.getTime() || 0;
    return bCreated - aCreated;
  });

  return visitors;
}

function renderVisitorList() {
  const container = $("visitorList");
  if (!container) return;

  const visitors = getFilteredVisitors();

  setText("visitorListSubText", `${visitors.length} visitor records shown`);

  if (!visitors.length) {
    container.innerHTML = `
      <div class="empty-state">
        No visitor requests found. Visitor requests from the resident app will appear here automatically.
      </div>
    `;
    return;
  }

  container.innerHTML = visitors.map((visitor) => {
    const status = getVisitorStatus(visitor);
    const purpose = getVisitorPurpose(visitor);

    return `
      <article class="visitor-row-card">
        <div class="avatar-box">${escapeHtml(getInitials(getGuestName(visitor)))}</div>

        <div class="row-text">
          <strong>${escapeHtml(getGuestName(visitor))}</strong>
          <span>${escapeHtml(getGuestPhone(visitor) || getGuestEmail(visitor) || "No phone")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getRequestedByName(visitor))}</strong>
          <span>${escapeHtml(getRequestedByRoom(visitor) || getRequestedByPhone(visitor) || "Resident")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getVisitorPropertyName(visitor))}</strong>
          <span>${escapeHtml(purpose)}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatDateTime(getVisitDateTime(visitor)))}</strong>
          <span>${escapeHtml(getVisitorSource(visitor))}</span>
        </div>

        <span class="tiny-chip ${statusClass(status)}">${escapeHtml(status)}</span>

        <div class="row-actions">
          <button type="button" title="View Details" data-view-visitor="${escapeHtml(visitor.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <select data-status-visitor="${escapeHtml(visitor.id)}" title="Change Status">
            ${VISITOR_STATUSES.map((item) => `
              <option value="${escapeHtml(item)}" ${status === item ? "selected" : ""}>
                ${escapeHtml(item)}
              </option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

function renderVisitorOverview() {
  const container = $("visitorOverviewList");
  if (!container) return;

  const summary = getSummary();

  const rows = [
    ["All Visitors", summary.totalVisitors, COLORS.navy],
    ["Pending Requests", summary.pendingRequests, COLORS.orange],
    ["Accepted Requests", summary.acceptedRequests, COLORS.green],
    ["Checked In", summary.checkedIn, COLORS.blue],
    ["Checked Out", summary.checkedOut, COLORS.purple],
    ["Restricted", summary.restricted, COLORS.red]
  ];

  container.innerHTML = rows.map(([label, value, color]) => {
    return `
      <div class="overview-line">
        <span>
          <i class="fa-solid fa-circle" style="color:${color}"></i>
          ${escapeHtml(label)}
        </span>
        <strong style="color:${color}">${value}</strong>
      </div>
    `;
  }).join("");
}

/* -----------------------------
   Add Visitor
------------------------------ */

function resetVisitorForm() {
  $("visitorForm")?.reset();

  fillResidentSelect();
  fillPropertySelect();

  $("visitorPurposeInput").value = "Personal Visit";
  $("visitorStatusInput").value = "Pending";
  $("visitorProofTypeInput").value = "Aadhaar";
  $("visitDateInput").value = dateInputValue(new Date());
  $("visitTimeInput").value = timeInputValue(new Date());
}

function fillResidentSelect() {
  const select = $("visitorResidentInput");
  if (!select) return;

  const residents = getResidentOptions();

  select.innerHTML = `<option value="">Select resident</option>`;

  residents.forEach((resident) => {
    const option = document.createElement("option");
    option.value = resident.id;
    option.textContent = `${resident.name}${resident.roomNo ? ` • ${resident.roomNo}` : resident.phone ? ` • ${resident.phone}` : ""}`;
    select.appendChild(option);
  });
}

function fillPropertySelect() {
  const select = $("visitorPropertyInput");
  if (!select) return;

  const properties = getPropertyOptions();

  select.innerHTML = `<option value="">Select property</option>`;

  properties.forEach((property) => {
    const option = document.createElement("option");
    option.value = property.id;
    option.textContent = property.name;
    select.appendChild(option);
  });
}

function openAddVisitorModal() {
  resetVisitorForm();
  openModal("visitorModal");
}

async function saveVisitor(event) {
  event.preventDefault();

  if (state.savingVisitor) return;

  const form = $("visitorForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const resident = findResident($("visitorResidentInput").value);
  const property = findProperty($("visitorPropertyInput").value);

  if (!resident || !property) {
    showToast("Selected resident or property not found.", "error");
    return;
  }

  state.savingVisitor = true;
  $("saveVisitorBtn").disabled = true;
  $("saveVisitorBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const ref = doc(collection(db, COLLECTIONS.visitors));
    const visitorNo = `VIS-${ref.id.slice(0, 6).toUpperCase()}`;

    await setDoc(ref, {
      visitorId: ref.id,
      visitorNo,
      guestName: $("guestNameInput").value.trim(),
      guestPhone: $("guestPhoneInput").value.trim(),
      guestEmail: $("guestEmailInput").value.trim(),
      guestIdProofType: $("visitorProofTypeInput").value,
      guestIdProofNumber: $("visitorProofNumberInput").value.trim(),
      vehicleNumber: $("visitorVehicleInput").value.trim(),
      requestedById: resident.id,
      residentId: resident.id,
      requestedByName: resident.name,
      residentName: resident.name,
      requestedByPhone: resident.phone,
      requestedByRoom: resident.roomNo,
      propertyId: property.id,
      propertyName: property.name,
      purpose: $("visitorPurposeInput").value,
      visitDateTime: Timestamp.fromDate(fromDateAndTime($("visitDateInput").value, $("visitTimeInput").value)),
      status: $("visitorStatusInput").value,
      visitorStatus: $("visitorStatusInput").value,
      notes: $("visitorNotesInput").value.trim(),
      source: "admin_website",
      createdBy: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Visitor request saved successfully.");
    closeModal("visitorModal");
  } catch (error) {
    console.error("Save visitor failed:", error);
    showToast(`Failed to save visitor: ${error.message}`, "error");
  } finally {
    state.savingVisitor = false;
    $("saveVisitorBtn").disabled = false;
    $("saveVisitorBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Visitor`;
  }
}

/* -----------------------------
   Visitor Status + Details
------------------------------ */

async function updateVisitorStatus(id, status) {
  const visitor = state.visitors.find((item) => item.id === id);

  try {
    const data = {
      status,
      visitorStatus: status,
      updatedAt: serverTimestamp()
    };

    if (status === "Accepted") data.acceptedAt = serverTimestamp();
    if (status === "Rejected") data.rejectedAt = serverTimestamp();
    if (status === "Checked In") data.checkedInAt = serverTimestamp();
    if (status === "Checked Out") data.checkedOutAt = serverTimestamp();
    if (status === "Restricted") data.restrictedAt = serverTimestamp();

    await setDoc(doc(db, COLLECTIONS.visitors, id), data, { merge: true });

    showToast(`${visitor ? getGuestName(visitor) : "Visitor"} marked as ${status}.`);
  } catch (error) {
    console.error("Visitor status update failed:", error);
    showToast(`Failed to update visitor: ${error.message}`, "error");
  }
}

function openVisitorDetail(id) {
  const visitor = state.visitors.find((item) => item.id === id);
  if (!visitor) return;

  setText("detailVisitorName", getGuestName(visitor));
  setText("detailVisitorNo", getVisitorNo(visitor));

  const content = $("visitorDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="detail-grid">
      ${detailLine("Guest Phone", getGuestPhone(visitor) || "-")}
      ${detailLine("Guest Email", getGuestEmail(visitor) || "-")}
      ${detailLine("Requested By", getRequestedByName(visitor))}
      ${detailLine("Resident Phone", getRequestedByPhone(visitor) || "-")}
      ${detailLine("Room / Bed", getRequestedByRoom(visitor) || "-")}
      ${detailLine("Property", getVisitorPropertyName(visitor))}
      ${detailLine("Purpose", getVisitorPurpose(visitor))}
      ${detailLine("Status", getVisitorStatus(visitor))}
      ${detailLine("Visit Time", formatDateTime(getVisitDateTime(visitor)))}
      ${detailLine("ID Proof", `${getGuestProofType(visitor)} ${getGuestProofNumber(visitor) ? `• ${getGuestProofNumber(visitor)}` : ""}`)}
      ${detailLine("Vehicle", getVehicleNumber(visitor) || "-")}
      ${detailLine("Source", getVisitorSource(visitor))}
    </div>

    <div class="detail-note">
      <strong>Notes</strong><br>
      ${escapeHtml(getVisitorNotes(visitor) || "No notes added.")}
    </div>

    <div class="detail-actions">
      <button type="button" class="gold-action" data-detail-status="${escapeHtml(visitor.id)}" data-status-value="Accepted">
        Accept
      </button>

      <button type="button" class="blue-action" data-detail-status="${escapeHtml(visitor.id)}" data-status-value="Checked In">
        Check In
      </button>

      <button type="button" class="purple-action" data-detail-status="${escapeHtml(visitor.id)}" data-status-value="Checked Out">
        Check Out
      </button>

      <button type="button" class="red-action" data-detail-status="${escapeHtml(visitor.id)}" data-status-value="Restricted">
        Restrict
      </button>
    </div>
  `;

  openModal("visitorDetailModal");
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

/* -----------------------------
   Colors
------------------------------ */

function statusColor(value) {
  const clean = normalizeVisitorStatus(value);

  if (clean === "Pending") return COLORS.orange;
  if (clean === "Accepted") return COLORS.green;
  if (clean === "Checked In") return COLORS.blue;
  if (clean === "Checked Out") return COLORS.purple;
  if (clean === "Restricted") return COLORS.red;
  if (clean === "Rejected") return COLORS.red;

  return COLORS.navy;
}

function paletteColor(label, index = 0) {
  const palette = [
    COLORS.navy,
    COLORS.gold,
    COLORS.green,
    COLORS.orange,
    COLORS.purple,
    COLORS.blue,
    COLORS.red
  ];

  return palette[index % palette.length];
}

/* -----------------------------
   Modal
------------------------------ */

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

/* -----------------------------
   Events
------------------------------ */

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Visitors refreshed.");
  });

  $("openVisitorModalBtn")?.addEventListener("click", openAddVisitorModal);

  $("visitorForm")?.addEventListener("submit", saveVisitor);

  $("visitorResidentInput")?.addEventListener("change", () => {
    const resident = findResident($("visitorResidentInput").value);

    if (resident && resident.propertyId) {
      $("visitorPropertyInput").value = resident.propertyId;
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
    "visitorSearchInput",
    "propertyFilter",
    "statusFilter",
    "purposeFilter",
    "sortFilter"
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", renderVisitorList);
    element.addEventListener("change", renderVisitorList);
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("visitorSearchInput").value = "";
    $("propertyFilter").value = "All Properties";
    $("statusFilter").value = "All Status";
    $("purposeFilter").value = "All Purpose";
    $("sortFilter").value = "Recently Added";

    renderVisitorList();
  });

  $("visitorList")?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view-visitor]");
    if (!viewButton) return;

    openVisitorDetail(viewButton.dataset.viewVisitor);
  });

  $("visitorList")?.addEventListener("change", (event) => {
    const statusSelect = event.target.closest("[data-status-visitor]");
    if (!statusSelect) return;

    updateVisitorStatus(statusSelect.dataset.statusVisitor, statusSelect.value);
  });

  $("visitorDetailContent")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail-status]");
    if (!button) return;

    updateVisitorStatus(button.dataset.detailStatus, button.dataset.statusValue);
    closeModal("visitorDetailModal");
  });
}

/* -----------------------------
   Init
------------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});