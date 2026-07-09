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
  staff: "staff",
  properties: "properties",
  leaveRequests: "leave_requests"
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

const state = {
  staff: [],
  properties: [],
  leaveRequests: [],
  quickFilter: "all",
  charts: {},
  savingStaff: false,
  unsubscribers: []
};

const STAFF_ROLES = [
  "Caretaker",
  "Plumber",
  "Electrician",
  "Housekeeping",
  "Security",
  "Technician",
  "Maintenance Staff",
  "Cook",
  "Supervisor",
  "Manager"
];

const STAFF_DEPARTMENTS = [
  "Maintenance",
  "Housekeeping",
  "Security",
  "Food",
  "Administration",
  "Operations"
];

const STAFF_SHIFTS = [
  "Morning Shift",
  "General Shift",
  "Evening Shift",
  "Night Shift"
];

const STAFF_ATTENDANCE = [
  "Present",
  "Absent",
  "Late",
  "On Leave"
];

const STAFF_DUTY = [
  "On Duty",
  "Off Duty",
  "On Leave"
];

const STAFF_AVAILABILITY = [
  "Available",
  "Unavailable",
  "Busy"
];

const STAFF_GENDER = [
  "Male",
  "Female",
  "Other"
];

const STAFF_EMPLOYMENT = [
  "Full Time",
  "Part Time",
  "Contract",
  "Temporary"
];

const STAFF_PROOF_TYPES = [
  "Aadhaar",
  "PAN",
  "Voter ID",
  "Driving License",
  "Passport",
  "Other"
];

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

function safeNumber(value) {
  if (value === null || value === undefined) return 0;

  const cleaned = String(value).replace(/[^0-9.]/g, "");
  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

function toDate(value) {
  if (!value) return null;

  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInputValue(value) {
  const date = toDate(value) || new Date();

  return date.toISOString().slice(0, 10);
}

function fromDateInput(value) {
  if (!value) return new Date();

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
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

function formatShortDate(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(safeNumber(value));
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "AD").trim();

  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function titleCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
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
  }, 2600);
}

/* -----------------------------
   Property + Staff Mappers
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

function findProperty(id) {
  return getPropertyOptions().find((property) => property.id === id) || null;
}

function propertyNameById(id) {
  const property = getPropertyOptions().find((item) => item.id === id);
  return property ? property.name : firstNonEmpty([id], "No Property");
}

function normalizeAttendance(value) {
  const clean = normalize(value);

  if (clean === "absent") return "Absent";
  if (clean === "late") return "Late";
  if (clean === "on leave" || clean === "leave" || clean === "on-leave") return "On Leave";

  return "Present";
}

function normalizeDuty(value) {
  const clean = normalize(value);

  if (clean === "off duty" || clean === "off-duty") return "Off Duty";
  if (clean === "on leave" || clean === "leave" || clean === "on-leave") return "On Leave";

  return "On Duty";
}

function normalizeShift(value) {
  const clean = String(value || "").trim();

  if (!clean) return "Morning Shift";

  const lower = clean.toLowerCase();

  if (lower.includes("morning")) return "Morning Shift";
  if (lower.includes("general")) return "General Shift";
  if (lower.includes("evening")) return "Evening Shift";
  if (lower.includes("night")) return "Night Shift";

  return titleCase(clean);
}

function shiftTimingForName(value) {
  const clean = normalize(value);

  if (clean.includes("morning")) return "06:00 AM - 02:00 PM";
  if (clean.includes("general")) return "09:00 AM - 06:00 PM";
  if (clean.includes("evening")) return "02:00 PM - 10:00 PM";
  if (clean.includes("night")) return "10:00 PM - 06:00 AM";

  return "09:00 AM - 06:00 PM";
}

function departmentForRole(value) {
  const clean = normalize(value);

  if (clean.includes("housekeeping")) return "Housekeeping";
  if (clean.includes("security")) return "Security";
  if (clean.includes("cook")) return "Food";
  if (clean.includes("manager") || clean.includes("supervisor")) return "Operations";

  return "Maintenance";
}

function safeChoice(value, allowed, fallback) {
  const clean = String(value || "").trim();
  return allowed.includes(clean) ? clean : fallback;
}

function getStaffId(staff) {
  return firstNonEmpty([staff.staffId, staff.employeeId], staff.id);
}

function getStaffName(staff) {
  return firstNonEmpty([staff.name, staff.fullName, staff.staffName, staff.displayName], "Staff Member");
}

function getStaffPhone(staff) {
  return firstNonEmpty([staff.phone, staff.mobile], "");
}

function getStaffEmail(staff) {
  return firstNonEmpty([staff.email], "");
}

function getStaffRole(staff) {
  return titleCase(firstNonEmpty([staff.role, staff.staffRole], "Staff"));
}

function getStaffDepartment(staff) {
  return firstNonEmpty([staff.department], departmentForRole(getStaffRole(staff)));
}

function getStaffPropertyId(staff) {
  return firstNonEmpty([staff.propertyId, staff.property_id], "");
}

function getStaffPropertyName(staff) {
  return firstNonEmpty([staff.propertyName, staff.property], propertyNameById(getStaffPropertyId(staff)));
}

function getStaffShiftName(staff) {
  return normalizeShift(firstNonEmpty([staff.shiftName, staff.shift], "Morning Shift"));
}

function getStaffShiftTiming(staff) {
  return firstNonEmpty([staff.shiftTiming, staff.timing], shiftTimingForName(getStaffShiftName(staff)));
}

function getStaffAttendance(staff) {
  return normalizeAttendance(firstNonEmpty([staff.attendanceStatus, staff.attendance], "Present"));
}

function getStaffDuty(staff) {
  return normalizeDuty(firstNonEmpty([staff.dutyStatus], "On Duty"));
}

function getStaffAvailability(staff) {
  return firstNonEmpty(
    [staff.availability, staff.availableStatus],
    staff.isAvailable === false ? "Unavailable" : "Available"
  );
}

function getStaffGender(staff) {
  return firstNonEmpty([staff.gender], "Male");
}

function getStaffEmployment(staff) {
  return firstNonEmpty([staff.employmentType], "Full Time");
}

function getStaffSalary(staff) {
  return safeNumber(staff.salary ?? staff.monthlySalary);
}

function getStaffAddress(staff) {
  return firstNonEmpty([staff.address], "");
}

function getStaffEmergencyName(staff) {
  return firstNonEmpty([staff.emergencyName], "");
}

function getStaffEmergencyPhone(staff) {
  return firstNonEmpty([staff.emergencyPhone], "");
}

function getStaffProofType(staff) {
  return firstNonEmpty([staff.idProofType], "Aadhaar");
}

function getStaffProofNumber(staff) {
  return firstNonEmpty([staff.idProofNumber], "");
}

function getStaffSkills(staff) {
  return firstNonEmpty([staff.skills, staff.skillSet], "");
}

function getStaffNotes(staff) {
  return firstNonEmpty([staff.notes], "");
}

function isActiveStaff(staff) {
  return staff.isActive !== false && staff.disabled !== true;
}

function getChipClass(value) {
  return normalize(value).replaceAll(" ", "-");
}

/* -----------------------------
   Leave Mappers
------------------------------ */

function getLeaveStatus(item) {
  const clean = normalize(item.status || item.leaveStatus || item.approvalStatus);

  if (clean.includes("approve")) return "Approved";
  if (clean.includes("reject") || clean.includes("decline")) return "Rejected";

  return "Pending";
}

function getLeaveStaffName(item) {
  return firstNonEmpty([item.staffName, item.name], findStaffNameById(item.staffId || item.staffDocId || item.employeeId) || "Staff");
}

function findStaffNameById(id) {
  const staff = state.staff.find((item) => {
    return (
      String(item.id) === String(id) ||
      String(item.staffId || "") === String(id) ||
      String(item.employeeId || "") === String(id)
    );
  });

  return staff ? getStaffName(staff) : "";
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
  listenCollection("staff", COLLECTIONS.staff);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("leaveRequests", COLLECTIONS.leaveRequests);
}

/* -----------------------------
   Render
------------------------------ */

function renderPage() {
  renderFilterOptions();
  renderStats();
  renderCharts();
  renderStaffList();
  renderSidePanels();
  renderBottomPanels();
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
  const staff = [...state.staff];

  const properties = [
    "All Properties",
    ...new Set(staff.map(getStaffPropertyName).filter(Boolean))
  ];

  const roles = [
    "All Roles",
    ...new Set(staff.map(getStaffRole).filter(Boolean))
  ];

  const duties = [
    "All Duty",
    ...new Set(staff.map(getStaffDuty).filter(Boolean))
  ];

  const shifts = [
    "All Shifts",
    ...new Set(staff.map(getStaffShiftName).filter(Boolean))
  ];

  updateSelect("propertyFilter", properties);
  updateSelect("roleFilter", roles);
  updateSelect("dutyFilter", duties);
  updateSelect("shiftFilter", shifts);
}

function getActiveStaffList() {
  return state.staff.filter(isActiveStaff);
}

function getSummary() {
  const activeStaff = getActiveStaffList();

  const presentToday = activeStaff.filter((staff) => getStaffAttendance(staff) === "Present").length;
  const onDuty = activeStaff.filter((staff) => getStaffDuty(staff) === "On Duty").length;
  const onLeave = activeStaff.filter((staff) => {
    return getStaffAttendance(staff) === "On Leave" || getStaffDuty(staff) === "On Leave";
  }).length;

  const pendingLeave = state.leaveRequests.filter((item) => getLeaveStatus(item) === "Pending").length;

  return {
    totalStaff: activeStaff.length,
    presentToday,
    onDuty,
    onLeave,
    pendingLeave
  };
}

function renderStats() {
  const summary = getSummary();

  setText("totalStaffValue", summary.totalStaff);
  setText("presentTodayValue", summary.presentToday);
  setText("onDutyValue", summary.onDuty);
  setText("onLeaveValue", summary.onLeave);
  setText("pendingLeavesValue", summary.pendingLeave);
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
  const activeStaff = getActiveStaffList();

  const roleMap = countBy(activeStaff, getStaffRole);
  const attendanceMap = countBy(activeStaff, getStaffAttendance);
  const dutyMap = countBy(activeStaff, getStaffDuty);
  const shiftMap = countBy(activeStaff, getStaffShiftName);

  renderBars("roleBars", roleMap, roleColor);
  renderBars("attendanceBars", attendanceMap, attendanceColor);
  renderDutyChart(dutyMap);
  renderBars("shiftBars", shiftMap, shiftColor);
}

function renderBars(id, map, colorGetter) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(map)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);

  const maxValue = Math.max(...entries.map((item) => item[1]), 0);

  if (!entries.length || !maxValue) {
    container.innerHTML = `<div class="empty-state small">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value]) => {
    const width = Math.round((value / maxValue) * 100);
    const color = colorGetter(label);

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

function renderDutyChart(map) {
  const labels = Object.keys(map);
  const values = Object.values(map);
  const total = values.reduce((sum, value) => sum + value, 0);

  setText("dutyChartCenter", total || 0);

  createChart("dutyChart", {
    type: "doughnut",
    data: {
      labels: total ? labels : ["No Data"],
      datasets: [
        {
          data: total ? values : [1],
          backgroundColor: total ? labels.map(dutyColor) : [COLORS.grey],
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

  const legend = $("dutyLegend");
  if (!legend) return;

  if (!total) {
    legend.innerHTML = `<div class="empty-state small">No duty chart data yet.</div>`;
    return;
  }

  legend.innerHTML = labels.map((label) => {
    return `
      <div class="legend-row">
        <span>
          <i class="legend-dot" style="background:${dutyColor(label)}"></i>
          ${escapeHtml(label)}
        </span>
        <strong>${map[label]}</strong>
      </div>
    `;
  }).join("");
}

/* -----------------------------
   Staff List
------------------------------ */

function getFilteredStaff() {
  let staffList = [...state.staff];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("staffSearchInput")?.value);
  const search = localSearch || globalSearch;

  const propertyFilter = $("propertyFilter")?.value || "All Properties";
  const roleFilter = $("roleFilter")?.value || "All Roles";
  const dutyFilter = $("dutyFilter")?.value || "All Duty";
  const shiftFilter = $("shiftFilter")?.value || "All Shifts";
  const activeStatusFilter = $("activeStatusFilter")?.value || "Active Staff";

  if (search) {
    staffList = staffList.filter((staff) => {
      const haystack = [
        getStaffName(staff),
        getStaffId(staff),
        getStaffPhone(staff),
        getStaffEmail(staff),
        getStaffRole(staff),
        getStaffDepartment(staff),
        getStaffPropertyName(staff),
        getStaffShiftName(staff),
        getStaffShiftTiming(staff),
        getStaffAttendance(staff),
        getStaffDuty(staff)
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (propertyFilter !== "All Properties") {
    staffList = staffList.filter((staff) => getStaffPropertyName(staff) === propertyFilter);
  }

  if (roleFilter !== "All Roles") {
    staffList = staffList.filter((staff) => getStaffRole(staff) === roleFilter);
  }

  if (dutyFilter !== "All Duty") {
    staffList = staffList.filter((staff) => getStaffDuty(staff) === dutyFilter);
  }

  if (shiftFilter !== "All Shifts") {
    staffList = staffList.filter((staff) => getStaffShiftName(staff) === shiftFilter);
  }

  if (activeStatusFilter === "Active Staff") {
    staffList = staffList.filter(isActiveStaff);
  }

  if (activeStatusFilter === "Inactive Staff") {
    staffList = staffList.filter((staff) => !isActiveStaff(staff));
  }

  if (state.quickFilter === "present") {
    staffList = staffList.filter((staff) => getStaffAttendance(staff) === "Present");
  }

  if (state.quickFilter === "on-duty") {
    staffList = staffList.filter((staff) => getStaffDuty(staff) === "On Duty");
  }

  if (state.quickFilter === "on-leave") {
    staffList = staffList.filter((staff) => {
      return getStaffAttendance(staff) === "On Leave" || getStaffDuty(staff) === "On Leave";
    });
  }

  staffList.sort((a, b) => {
    if (isActiveStaff(a) !== isActiveStaff(b)) {
      return isActiveStaff(a) ? -1 : 1;
    }

    return getStaffName(a).localeCompare(getStaffName(b));
  });

  return staffList;
}

function renderStaffList() {
  const container = $("staffList");
  if (!container) return;

  const staffList = getFilteredStaff();

  setText("staffListSubText", `${staffList.length} staff records shown`);

  if (!staffList.length) {
    container.innerHTML = `<div class="empty-state">No staff found. Click Add Staff to create staff records.</div>`;
    return;
  }

  container.innerHTML = staffList.map((staff) => {
    const active = isActiveStaff(staff);
    const attendance = getStaffAttendance(staff);
    const duty = getStaffDuty(staff);

    return `
      <article class="staff-row-card ${active ? "" : "inactive"}">
        <div class="avatar-box">${escapeHtml(getInitials(getStaffName(staff)))}</div>

        <div class="row-text">
          <strong>${escapeHtml(getStaffName(staff))}</strong>
          <span>${escapeHtml(getStaffPhone(staff) || getStaffEmail(staff) || "No phone")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getStaffRole(staff))}</strong>
          <span>${escapeHtml(getStaffDepartment(staff))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getStaffPropertyName(staff))}</strong>
          <span>${escapeHtml(getStaffShiftName(staff))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getStaffShiftTiming(staff))}</strong>
          <span>${escapeHtml(getStaffAvailability(staff))}</span>
        </div>

        <span class="tiny-chip ${getChipClass(attendance)}">${escapeHtml(attendance)}</span>
        <span class="tiny-chip ${getChipClass(duty)}">${escapeHtml(duty)}</span>

        <div class="row-actions">
          <button type="button" title="View" data-view-staff="${escapeHtml(staff.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <button type="button" title="Edit" data-edit-staff="${escapeHtml(staff.id)}">
            <i class="fa-regular fa-pen-to-square"></i>
          </button>

          <button type="button" title="Toggle Duty" data-toggle-duty="${escapeHtml(staff.id)}">
            <i class="fa-solid fa-toggle-on"></i>
          </button>

          <button type="button" class="delete-btn" title="Deactivate" data-deactivate-staff="${escapeHtml(staff.id)}" ${active ? "" : "disabled"}>
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");
}

/* -----------------------------
   Side + Bottom Panels
------------------------------ */

function renderSidePanels() {
  const activeStaff = getActiveStaffList();
  const roleMap = countBy(activeStaff, getStaffRole);
  const employmentMap = countBy(activeStaff, getStaffEmployment);
  const summary = getSummary();

  setText("roleDistributionSub", `${summary.totalStaff} total active staff`);

  renderSideRoleList(roleMap);
  renderQuickValues(summary);
  renderBars("employmentBars", employmentMap, employmentColor);

  document.querySelectorAll("[data-quick-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quickFilter === state.quickFilter);
  });
}

function renderSideRoleList(roleMap) {
  const container = $("roleDistributionList");
  if (!container) return;

  const entries = Object.entries(roleMap).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state small">No role data yet.</div>`;
    return;
  }

  const maxValue = Math.max(...entries.map((item) => item[1]), 0);

  container.innerHTML = entries.map(([label, value]) => {
    const width = maxValue ? Math.round((value / maxValue) * 100) : 0;
    const color = roleColor(label);

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

function renderQuickValues(summary) {
  setText("quickAllValue", summary.totalStaff);
  setText("quickPresentValue", summary.presentToday);
  setText("quickDutyValue", summary.onDuty);
  setText("quickLeaveValue", summary.onLeave);
  setText("quickPendingLeaveValue", summary.pendingLeave);
}

function renderBottomPanels() {
  const activeStaff = getActiveStaffList();

  renderBars("attendanceOverviewList", countBy(activeStaff, getStaffAttendance), attendanceColor);
  renderBars("shiftList", countBy(activeStaff, getStaffShiftName), shiftColor);
  renderLeaveRequests();
}

function renderLeaveRequests() {
  const container = $("leaveRequestList");
  if (!container) return;

  const requests = [...state.leaveRequests].sort((a, b) => {
    const aTime = toDate(a.createdAt || a.requestDate)?.getTime() || 0;
    const bTime = toDate(b.createdAt || b.requestDate)?.getTime() || 0;
    return bTime - aTime;
  });

  if (!requests.length) {
    container.innerHTML = `<div class="empty-state small">No leave requests found.</div>`;
    return;
  }

  container.innerHTML = requests.slice(0, 8).map((item) => {
    const status = getLeaveStatus(item);
    const statusClass = getChipClass(status);
    const fromDate = item.fromDate || item.startDate;
    const toDateValue = item.toDate || item.endDate;

    return `
      <div class="leave-card">
        <div class="leave-avatar">${escapeHtml(getInitials(getLeaveStaffName(item)))}</div>

        <div class="row-text">
          <strong>${escapeHtml(getLeaveStaffName(item))}</strong>
          <span>${escapeHtml(item.leaveType || item.type || "Leave")} • ${escapeHtml(formatShortDate(fromDate))} - ${escapeHtml(formatShortDate(toDateValue))}</span>
          <span>${escapeHtml(item.reason || item.notes || "-")}</span>
        </div>

        ${status === "Pending" ? `
          <div class="leave-actions">
            <button class="approve-btn" type="button" title="Approve" data-leave-action="Approved" data-leave-id="${escapeHtml(item.id)}">
              <i class="fa-solid fa-check"></i>
            </button>
            <button class="reject-btn" type="button" title="Reject" data-leave-action="Rejected" data-leave-id="${escapeHtml(item.id)}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        ` : `
          <span class="tiny-chip ${statusClass}">${escapeHtml(status)}</span>
        `}
      </div>
    `;
  }).join("");
}

/* -----------------------------
   Staff Actions
------------------------------ */

function openAddStaffModal() {
  resetStaffForm();
  setText("staffModalTitle", "Add Staff");
  $("staffEditId").value = "";
  $("saveStaffBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Staff`;
  openModal("staffModal");
}

function openEditStaffModal(id) {
  const staff = state.staff.find((item) => item.id === id);
  if (!staff) return;

  resetStaffForm();
  setText("staffModalTitle", "Edit Staff");

  $("staffEditId").value = staff.id;
  $("staffNameInput").value = getStaffName(staff);
  $("staffIdInput").value = getStaffId(staff);
  $("employmentTypeInput").value = safeChoice(getStaffEmployment(staff), STAFF_EMPLOYMENT, "Full Time");
  $("staffPhoneInput").value = getStaffPhone(staff);
  $("staffEmailInput").value = getStaffEmail(staff);
  $("staffPropertyInput").value = getStaffPropertyId(staff);
  $("staffRoleInput").value = safeChoice(getStaffRole(staff), STAFF_ROLES, "Caretaker");
  $("staffDepartmentInput").value = safeChoice(getStaffDepartment(staff), STAFF_DEPARTMENTS, departmentForRole(getStaffRole(staff)));
  $("staffShiftInput").value = safeChoice(getStaffShiftName(staff), STAFF_SHIFTS, "Morning Shift");
  $("staffShiftTimingInput").value = getStaffShiftTiming(staff);
  $("staffAttendanceInput").value = safeChoice(getStaffAttendance(staff), STAFF_ATTENDANCE, "Present");
  $("staffDutyInput").value = safeChoice(getStaffDuty(staff), STAFF_DUTY, "On Duty");
  $("staffAvailabilityInput").value = safeChoice(getStaffAvailability(staff), STAFF_AVAILABILITY, "Available");
  $("staffGenderInput").value = safeChoice(getStaffGender(staff), STAFF_GENDER, "Male");
  $("staffJoiningDateInput").value = dateInputValue(staff.joiningDate);
  $("staffSalaryInput").value = getStaffSalary(staff) || "";
  $("staffProofTypeInput").value = safeChoice(getStaffProofType(staff), STAFF_PROOF_TYPES, "Aadhaar");
  $("staffProofNumberInput").value = getStaffProofNumber(staff);
  $("staffEmergencyNameInput").value = getStaffEmergencyName(staff);
  $("staffEmergencyPhoneInput").value = getStaffEmergencyPhone(staff);
  $("staffAddressInput").value = getStaffAddress(staff);
  $("staffSkillsInput").value = getStaffSkills(staff);
  $("staffNotesInput").value = getStaffNotes(staff);
  $("staffActiveInput").checked = isActiveStaff(staff);

  $("saveStaffBtn").innerHTML = `<i class="fa-solid fa-check"></i> Update Staff`;
  openModal("staffModal");
}

function resetStaffForm() {
  $("staffForm")?.reset();

  fillPropertySelect();

  $("staffEditId").value = "";
  $("staffIdInput").value = "";
  $("employmentTypeInput").value = "Full Time";
  $("staffRoleInput").value = "Caretaker";
  $("staffDepartmentInput").value = "Maintenance";
  $("staffShiftInput").value = "Morning Shift";
  $("staffShiftTimingInput").value = "06:00 AM - 02:00 PM";
  $("staffAttendanceInput").value = "Present";
  $("staffDutyInput").value = "On Duty";
  $("staffAvailabilityInput").value = "Available";
  $("staffGenderInput").value = "Male";
  $("staffJoiningDateInput").value = dateInputValue(new Date());
  $("staffProofTypeInput").value = "Aadhaar";
  $("staffSkillsInput").value = "General maintenance, resident support";
  $("staffActiveInput").checked = true;
}

function fillPropertySelect() {
  const select = $("staffPropertyInput");
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

async function saveStaff(event) {
  event.preventDefault();

  if (state.savingStaff) return;

  const form = $("staffForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const property = findProperty($("staffPropertyInput").value);

  if (!property) {
    showToast("Selected property not found.", "error");
    return;
  }

  state.savingStaff = true;
  $("saveStaffBtn").disabled = true;
  $("saveStaffBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const editId = $("staffEditId").value;
    const ref = editId
      ? doc(db, COLLECTIONS.staff, editId)
      : doc(collection(db, COLLECTIONS.staff));

    const generatedStaffId = `STF-${ref.id.slice(0, 5).toUpperCase()}`;
    const cleanStaffId = $("staffIdInput").value.trim() || generatedStaffId;

    const name = $("staffNameInput").value.trim();
    const phone = $("staffPhoneInput").value.trim();
    const email = $("staffEmailInput").value.trim();
    const role = $("staffRoleInput").value;
    const department = $("staffDepartmentInput").value;
    const shiftName = $("staffShiftInput").value;
    const shiftTiming = $("staffShiftTimingInput").value.trim() || shiftTimingForName(shiftName);
    const availability = $("staffAvailabilityInput").value;

    await setDoc(
      ref,
      {
        staffId: cleanStaffId,
        name,
        fullName: name,
        phone,
        mobile: phone,
        email,
        role,
        staffRole: role,
        department,
        propertyId: property.id,
        propertyName: property.name,
        shiftName,
        shiftTiming,
        attendanceStatus: $("staffAttendanceInput").value,
        dutyStatus: $("staffDutyInput").value,
        availability,
        isAvailable: availability.toLowerCase() === "available",
        gender: $("staffGenderInput").value,
        employmentType: $("employmentTypeInput").value,
        salary: safeNumber($("staffSalaryInput").value),
        address: $("staffAddressInput").value.trim(),
        emergencyName: $("staffEmergencyNameInput").value.trim(),
        emergencyPhone: $("staffEmergencyPhoneInput").value.trim(),
        idProofType: $("staffProofTypeInput").value,
        idProofNumber: $("staffProofNumberInput").value.trim(),
        skills: $("staffSkillsInput").value.trim(),
        notes: $("staffNotesInput").value.trim(),
        joiningDate: Timestamp.fromDate(fromDateInput($("staffJoiningDateInput").value)),
        isActive: $("staffActiveInput").checked,
        updatedAt: serverTimestamp(),
        ...(editId ? {} : { createdAt: serverTimestamp() })
      },
      { merge: true }
    );

    showToast(editId ? "Staff updated successfully." : "Staff added successfully.");
    closeModal("staffModal");
  } catch (error) {
    console.error("Save staff failed:", error);
    showToast(`Failed to save staff: ${error.message}`, "error");
  } finally {
    state.savingStaff = false;
    $("saveStaffBtn").disabled = false;
    $("saveStaffBtn").innerHTML = $("staffEditId").value
      ? `<i class="fa-solid fa-check"></i> Update Staff`
      : `<i class="fa-solid fa-check"></i> Save Staff`;
  }
}

async function toggleDuty(id) {
  const staff = state.staff.find((item) => item.id === id);
  if (!staff) return;

  const current = getStaffDuty(staff);
  const newDuty = current === "On Duty" ? "Off Duty" : "On Duty";

  try {
    await setDoc(
      doc(db, COLLECTIONS.staff, id),
      {
        dutyStatus: newDuty,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast(`Duty changed to ${newDuty}.`);
  } catch (error) {
    console.error("Toggle duty failed:", error);
    showToast(`Failed to update duty: ${error.message}`, "error");
  }
}

async function deactivateStaff(id) {
  const staff = state.staff.find((item) => item.id === id);
  if (!staff) return;

  if (!window.confirm(`Deactivate ${getStaffName(staff)}?`)) return;

  try {
    await setDoc(
      doc(db, COLLECTIONS.staff, id),
      {
        isActive: false,
        dutyStatus: "Off Duty",
        availability: "Unavailable",
        isAvailable: false,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast("Staff deactivated successfully.");
  } catch (error) {
    console.error("Deactivate staff failed:", error);
    showToast(`Failed to deactivate staff: ${error.message}`, "error");
  }
}

function openStaffDetail(id) {
  const staff = state.staff.find((item) => item.id === id);
  if (!staff) return;

  setText("detailStaffName", getStaffName(staff));
  setText("detailStaffSub", `${getStaffRole(staff)} • ${getStaffPropertyName(staff)}`);

  const content = $("staffDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="detail-grid">
      ${detailLine("Staff ID", getStaffId(staff))}
      ${detailLine("Phone", getStaffPhone(staff) || "-")}
      ${detailLine("Email", getStaffEmail(staff) || "-")}
      ${detailLine("Property", getStaffPropertyName(staff))}
      ${detailLine("Role", getStaffRole(staff))}
      ${detailLine("Department", getStaffDepartment(staff))}
      ${detailLine("Shift", getStaffShiftName(staff))}
      ${detailLine("Shift Timing", getStaffShiftTiming(staff))}
      ${detailLine("Attendance", getStaffAttendance(staff))}
      ${detailLine("Duty Status", getStaffDuty(staff))}
      ${detailLine("Availability", getStaffAvailability(staff))}
      ${detailLine("Employment Type", getStaffEmployment(staff))}
      ${detailLine("Salary", formatMoney(getStaffSalary(staff)))}
      ${detailLine("Joining Date", formatDate(staff.joiningDate))}
      ${detailLine("Gender", getStaffGender(staff))}
      ${detailLine("ID Proof", `${getStaffProofType(staff)} ${getStaffProofNumber(staff) ? `• ${getStaffProofNumber(staff)}` : ""}`)}
      ${detailLine("Emergency Contact", firstNonEmpty([getStaffEmergencyName(staff), getStaffEmergencyPhone(staff)], "-"))}
      ${detailLine("Active", isActiveStaff(staff) ? "Yes" : "No")}
    </div>

    <div class="detail-note">
      <strong>Address:</strong><br>
      ${escapeHtml(getStaffAddress(staff) || "-")}
      <br><br>
      <strong>Skills:</strong><br>
      ${escapeHtml(getStaffSkills(staff) || "-")}
      <br><br>
      <strong>Notes:</strong><br>
      ${escapeHtml(getStaffNotes(staff) || "-")}
    </div>
  `;

  openModal("staffDetailModal");
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

async function updateLeaveRequest(id, status) {
  try {
    await setDoc(
      doc(db, COLLECTIONS.leaveRequests, id),
      {
        status,
        leaveStatus: status,
        updatedAt: serverTimestamp(),
        ...(status === "Approved" ? { approvedAt: serverTimestamp() } : {}),
        ...(status === "Rejected" ? { rejectedAt: serverTimestamp() } : {})
      },
      { merge: true }
    );

    showToast(`Leave request ${status.toLowerCase()}.`);
  } catch (error) {
    console.error("Leave update failed:", error);
    showToast(`Leave update failed: ${error.message}`, "error");
  }
}

/* -----------------------------
   Export
------------------------------ */

function exportStaffCsv() {
  const staffList = getFilteredStaff();

  const rows = [
    [
      "Staff Name",
      "Staff ID",
      "Phone",
      "Email",
      "Role",
      "Department",
      "Property",
      "Shift",
      "Shift Timing",
      "Attendance",
      "Duty",
      "Availability",
      "Employment",
      "Salary",
      "Active"
    ],
    ...staffList.map((staff) => [
      getStaffName(staff),
      getStaffId(staff),
      getStaffPhone(staff),
      getStaffEmail(staff),
      getStaffRole(staff),
      getStaffDepartment(staff),
      getStaffPropertyName(staff),
      getStaffShiftName(staff),
      getStaffShiftTiming(staff),
      getStaffAttendance(staff),
      getStaffDuty(staff),
      getStaffAvailability(staff),
      getStaffEmployment(staff),
      getStaffSalary(staff),
      isActiveStaff(staff) ? "Yes" : "No"
    ])
  ];

  const csv = rows.map((row) => {
    return row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",");
  }).join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "staff-management-report.csv";
  link.click();

  URL.revokeObjectURL(url);
}

/* -----------------------------
   Colors
------------------------------ */

function attendanceColor(value) {
  const clean = normalize(value);

  if (clean === "present") return COLORS.green;
  if (clean === "absent") return COLORS.red;
  if (clean === "late") return COLORS.orange;
  if (clean === "on leave") return COLORS.purple;

  return COLORS.navy;
}

function dutyColor(value) {
  const clean = normalize(value);

  if (clean === "on duty") return COLORS.green;
  if (clean === "off duty") return COLORS.orange;
  if (clean === "on leave") return COLORS.purple;

  return COLORS.navy;
}

function shiftColor(value) {
  const clean = normalize(value);

  if (clean.includes("morning")) return COLORS.green;
  if (clean.includes("general")) return COLORS.gold;
  if (clean.includes("evening")) return COLORS.orange;
  if (clean.includes("night")) return COLORS.purple;

  return COLORS.navy;
}

function employmentColor(value) {
  const clean = normalize(value);

  if (clean.includes("full")) return COLORS.green;
  if (clean.includes("part")) return COLORS.gold;
  if (clean.includes("contract")) return COLORS.purple;
  if (clean.includes("temporary")) return COLORS.orange;

  return COLORS.navy;
}

function roleColor(value) {
  const clean = normalize(value);

  if (clean.includes("plumber")) return COLORS.blue;
  if (clean.includes("electrician")) return COLORS.orange;
  if (clean.includes("housekeeping")) return COLORS.red;
  if (clean.includes("security")) return COLORS.purple;
  if (clean.includes("caretaker")) return COLORS.green;
  if (clean.includes("cook")) return COLORS.gold;
  if (clean.includes("manager")) return COLORS.navy;

  return COLORS.gold;
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
    showToast("Staff management refreshed.");
  });

  $("openStaffModalBtn")?.addEventListener("click", openAddStaffModal);

  $("staffForm")?.addEventListener("submit", saveStaff);

  $("staffRoleInput")?.addEventListener("change", () => {
    $("staffDepartmentInput").value = departmentForRole($("staffRoleInput").value);
  });

  $("staffShiftInput")?.addEventListener("change", () => {
    $("staffShiftTimingInput").value = shiftTimingForName($("staffShiftInput").value);
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
    "staffSearchInput",
    "propertyFilter",
    "roleFilter",
    "dutyFilter",
    "shiftFilter",
    "activeStatusFilter"
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", () => {
      renderStaffList();
    });

    element.addEventListener("change", () => {
      renderStaffList();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("staffSearchInput").value = "";
    $("propertyFilter").value = "All Properties";
    $("roleFilter").value = "All Roles";
    $("dutyFilter").value = "All Duty";
    $("shiftFilter").value = "All Shifts";
    $("activeStatusFilter").value = "Active Staff";
    state.quickFilter = "all";

    renderPage();
  });

  $("exportStaffBtn")?.addEventListener("click", exportStaffCsv);

  $("staffList")?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view-staff]");
    if (viewButton) {
      openStaffDetail(viewButton.dataset.viewStaff);
      return;
    }

    const editButton = event.target.closest("[data-edit-staff]");
    if (editButton) {
      openEditStaffModal(editButton.dataset.editStaff);
      return;
    }

    const toggleButton = event.target.closest("[data-toggle-duty]");
    if (toggleButton) {
      toggleDuty(toggleButton.dataset.toggleDuty);
      return;
    }

    const deactivateButton = event.target.closest("[data-deactivate-staff]");
    if (deactivateButton) {
      deactivateStaff(deactivateButton.dataset.deactivateStaff);
    }
  });

  document.querySelectorAll("[data-quick-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.quickFilter;

      if (filter === "pending-leaves") {
        document.querySelector("#leaveRequestList")?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        return;
      }

      state.quickFilter = filter;
      renderStaffList();
      renderSidePanels();
    });
  });

  $("leaveRequestList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-leave-id]");
    if (!button) return;

    updateLeaveRequest(button.dataset.leaveId, button.dataset.leaveAction);
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