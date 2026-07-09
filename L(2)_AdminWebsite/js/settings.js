import { auth, db } from "./firebase-config.js";

import {
  initializeApp,
  deleteApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
  onAuthStateChanged,
  signOut,
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  staffLoginAccounts: "staff_login_accounts",
  users: "users",
  staff: "staff",
  mail: "mail",
  staffLoginEmailLogs: "staff_login_email_logs"
};

const ACCOUNT_ROLES = ["Admin", "Staff"];
const ACCOUNT_STATUSES = ["Active", "Inactive", "Suspended"];

const COLORS = {
  navy: "#1f2a44",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  blue: "#2f80ed",
  orange: "#e18a00",
  purple: "#6352c7"
};

const state = {
  staffLoginAccounts: [],
  users: [],
  staff: [],
  selectedEmployee: null,
  selectedDetailsUid: "",
  selectedEditUid: "",
  saving: false
};

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

function shortDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  });
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
  }, 3000);
}

function value(id) {
  return String($(id)?.value || "").trim();
}

/* AUTH */

function setupAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "../index.html";
      return;
    }

    const name = user.displayName || localStorage.getItem("loggedInUserName") || "Admin";
    const email = user.email || localStorage.getItem("loggedInUserEmail") || "admin@email.com";
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

/* LAYOUT */

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

    document.querySelectorAll(".nav-dropdown.active").forEach((dropdown) => {
      dropdown.classList.remove("active");
    });
  });

  profileDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", (event) => {
    const dropdownButton = event.target.closest(".nav-dropdown-btn");
    const dropdownBox = event.target.closest(".nav-dropdown");
    const submenuLink = event.target.closest(".nav-submenu a");

    if (dropdownButton && dropdownBox) {
      event.preventDefault();
      event.stopPropagation();

      const alreadyOpen = dropdownBox.classList.contains("active");

      document.querySelectorAll(".nav-dropdown.active").forEach((dropdown) => {
        dropdown.classList.remove("active");
      });

      if (!alreadyOpen) dropdownBox.classList.add("active");

      profileDropdown?.classList.remove("show");
      return;
    }

    if (submenuLink) {
      document.querySelectorAll(".nav-dropdown.active").forEach((dropdown) => {
        dropdown.classList.remove("active");
      });
      return;
    }

    if (!dropdownBox) {
      document.querySelectorAll(".nav-dropdown.active").forEach((dropdown) => {
        dropdown.classList.remove("active");
      });

      if (!event.target.closest(".admin-profile-box")) {
        profileDropdown?.classList.remove("show");
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      profileDropdown?.classList.remove("show");
      document.querySelectorAll(".nav-dropdown.active").forEach((dropdown) => {
        dropdown.classList.remove("active");
      });
    }
  });
}

/* FIREBASE */

function listenCollection(stateKey, collectionName) {
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
      showToast(`${collectionName} fetch failed: ${error.message}`, "error");
    }
  );
}

function setupFirebase() {
  listenCollection("staffLoginAccounts", COLLECTIONS.staffLoginAccounts);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("staff", COLLECTIONS.staff);
}

/* NORMALIZERS */

function normalizeRole(role) {
  const clean = normalize(role);

  if (clean === "admin" || clean === "super admin" || clean === "super_admin") return "Admin";

  return "Staff";
}

function normalizeStatus(status) {
  const clean = normalize(status);

  if (clean === "active" || clean === "enabled") return "Active";
  if (clean === "inactive" || clean === "disabled") return "Inactive";
  if (clean === "suspended" || clean === "blocked") return "Suspended";

  return "Active";
}

function accountStatusRank(status) {
  const clean = normalizeStatus(status);

  if (clean === "Active") return 1;
  if (clean === "Inactive") return 2;
  if (clean === "Suspended") return 3;

  return 4;
}

function permissionsForRole(role) {
  if (role === "Admin") {
    return [
      "dashboard",
      "properties",
      "residents",
      "bookings",
      "billing",
      "food",
      "complaints",
      "staff",
      "visitors",
      "parcels",
      "agreements_kyc",
      "referrals",
      "corporate",
      "reports",
      "settings"
    ];
  }

  return [
    "dashboard",
    "complaints",
    "visitors",
    "parcels"
  ];
}

/* ACCOUNT + EMPLOYEE MERGE */

function accountFromData(id, data, source = "Users") {
  return {
    id,
    uid: firstNonEmpty([data.uid, id]),
    staffName: firstNonEmpty([
      data.staffName,
      data.name,
      data.fullName,
      data.displayName
    ], "Account User"),
    staffId: firstNonEmpty([data.staffId, data.employeeId, data.adminId], ""),
    email: firstNonEmpty([data.email, data.username], "No Email").toLowerCase(),
    role: normalizeRole(firstNonEmpty([
      data.role,
      data.userRole,
      data.type
    ], "Staff")),
    accountStatus: normalizeStatus(firstNonEmpty([
      data.accountStatus,
      data.loginStatus,
      data.status,
      data.isActive === true ? "Active" : ""
    ], "Active")),
    source,
    lastLoginAt: data.lastLoginAt || data.lastLogin || data.lastSeenAt || null,
    createdAt: data.createdAt || null,
    raw: data
  };
}

function getMergedAccounts() {
  const map = new Map();

  state.staffLoginAccounts.forEach((item) => {
    const account = accountFromData(item.id, item, "Login Account");
    map.set(account.uid, account);
  });

  state.users.forEach((item) => {
    const role = normalize(firstNonEmpty([item.role, item.userRole, item.type], ""));

    const isAdminOrStaff =
      role === "admin" ||
      role === "super admin" ||
      role === "super_admin" ||
      role === "staff";

    if (!isAdminOrStaff) return;

    const account = accountFromData(item.id, item, "Users");
    if (!map.has(account.uid)) map.set(account.uid, account);
  });

  state.staff.forEach((item) => {
    const account = accountFromData(
      item.id,
      {
        ...item,
        role: firstNonEmpty([item.role, item.userRole, item.type], "Staff")
      },
      "Staff"
    );

    if (!map.has(account.uid)) map.set(account.uid, account);
  });

  return Array.from(map.values()).sort((a, b) => {
    const rankA = accountStatusRank(a.accountStatus);
    const rankB = accountStatusRank(b.accountStatus);

    if (rankA !== rankB) return rankA - rankB;

    const aTime = toDate(a.createdAt)?.getTime() || 0;
    const bTime = toDate(b.createdAt)?.getTime() || 0;

    return bTime - aTime;
  });
}

function employeeFromData(id, data, source = "Staff", defaultRole = "Staff") {
  const role = normalizeRole(firstNonEmpty([
    defaultRole,
    data.loginRole,
    data.accountRole,
    data.role,
    data.userRole,
    data.type
  ], "Staff"));

  const employee = {
    id,
    uid: firstNonEmpty([data.uid, id]),
    name: firstNonEmpty([
      data.staffName,
      data.name,
      data.fullName,
      data.displayName
    ], "Employee"),
    staffId: firstNonEmpty([data.staffId, data.employeeId, data.adminId], ""),
    email: firstNonEmpty([data.email, data.username, data.loginEmail], "").toLowerCase(),
    loginRole: role,
    phone: firstNonEmpty([data.phone, data.mobile, data.phoneNumber], ""),
    department: firstNonEmpty([data.department], ""),
    propertyId: firstNonEmpty([data.propertyId, data.property_id], ""),
    propertyName: firstNonEmpty([
      data.propertyName,
      data.property,
      data.propertyLocation
    ], ""),
    shiftName: firstNonEmpty([data.shiftName, data.shift], ""),
    shiftTiming: firstNonEmpty([data.shiftTiming, data.timing], ""),
    source
  };

  employee.displayLabel = [
    employee.name,
    employee.email && employee.email !== "no email" ? employee.email : "",
    employee.propertyName
  ].filter(Boolean).join(" - ");

  employee.searchText = [
    employee.name,
    employee.staffId,
    employee.email,
    employee.loginRole,
    employee.phone,
    employee.department,
    employee.propertyName,
    employee.shiftName,
    employee.shiftTiming
  ].join(" ").toLowerCase();

  return employee;
}

function getEmployeeOptions() {
  const map = new Map();

  function addEmployee(employee) {
    const key = firstNonEmpty([
      employee.uid,
      employee.email,
      employee.staffId,
      employee.id
    ], "").toLowerCase();

    if (!key) return;

    map.set(key, employee);
  }

  state.staff.forEach((item) => {
    addEmployee(employeeFromData(item.id, item, "Staff", "Staff"));
  });

  state.users.forEach((item) => {
    const role = normalizeRole(firstNonEmpty([
      item.role,
      item.userRole,
      item.type
    ], "Staff"));

    if (role !== "Admin" && role !== "Staff") return;

    addEmployee(employeeFromData(item.id, item, "Users", role));
  });

  return Array.from(map.values()).sort((a, b) => {
    const roleCompare = a.loginRole.localeCompare(b.loginRole);
    if (roleCompare !== 0) return roleCompare;
    return a.name.localeCompare(b.name);
  });
}

function filteredEmployees() {
  const role = value("loginRoleInput") || "Staff";
  const search = normalize(value("employeeSearchInput"));

  const employees = getEmployeeOptions();
  const roleEmployees = role === "Admin"
    ? employees
    : employees.filter((employee) => employee.loginRole === role);

  const source = roleEmployees.length ? roleEmployees : employees;

  return source.filter((employee) => {
    return !search || employee.searchText.includes(search);
  }).slice(0, 25);
}

function filteredAccounts() {
  const search = normalize(value("staffSearchInput") || value("globalSearchInput"));
  const statusFilter = value("statusFilterInput") || "All Accounts";

  return getMergedAccounts().filter((account) => {
    const matchesSearch = !search || [
      account.staffName,
      account.email,
      account.staffId,
      account.role,
      account.accountStatus,
      account.source
    ].join(" ").toLowerCase().includes(search);

    const matchesStatus =
      statusFilter === "All Accounts" ||
      account.accountStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });
}

/* RENDER */

function renderPage() {
  renderEmployeeSearchLabel();
  renderEmployeeResults();
  renderSelectedEmployeeCard();
  renderStats();
  renderCharts();
  renderAccountsTable();
}

function renderEmployeeSearchLabel() {
  const role = value("loginRoleInput") || "Staff";
  setText("employeeSearchLabel", role === "Admin" ? "Search Added Staff / Employee *" : "Search Staff Employee *");
}

function renderEmployeeResults() {
  const container = $("employeeResults");
  if (!container) return;

  if (state.selectedEmployee) {
    container.innerHTML = `
      <button type="button" class="employee-option selected" data-employee-id="${escapeHtml(state.selectedEmployee.id)}">
        <div class="employee-avatar">${escapeHtml(getInitials(state.selectedEmployee.name))}</div>
        <div class="employee-text">
          <strong>${escapeHtml(state.selectedEmployee.name)}</strong>
          <span>${escapeHtml(state.selectedEmployee.displayLabel)}</span>
        </div>
      </button>
    `;
    return;
  }

  const employees = filteredEmployees();

  if (!employees.length) {
    const role = value("loginRoleInput") || "Staff";
    container.innerHTML = `
      <div class="empty-result">No ${escapeHtml(role)} employees found. Add employees first, then search here.</div>
    `;
    return;
  }

  container.innerHTML = employees.map((employee) => {
    return `
      <button type="button" class="employee-option" data-employee-id="${escapeHtml(employee.id)}">
        <div class="employee-avatar">${escapeHtml(getInitials(employee.name))}</div>
        <div class="employee-text">
          <strong>${escapeHtml(employee.name)}</strong>
          <span>${escapeHtml(employee.displayLabel)}</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderSelectedEmployeeCard() {
  const card = $("selectedEmployeeCard");
  const tags = $("selectedEmployeeTags");
  const employee = state.selectedEmployee;

  if (!card || !tags) return;

  if (!employee) {
    card.hidden = true;
    tags.innerHTML = "";
    return;
  }

  card.hidden = false;

  const details = [
    ["Employee Role", employee.loginRole],
    ["Email", employee.email],
    ["Phone", employee.phone],
    ["Department", employee.department],
    ["Property", employee.propertyName],
    ["Shift", employee.shiftName],
    ["Timing", employee.shiftTiming],
    ["Source", employee.source]
  ];

  tags.innerHTML = details
    .filter(([, val]) => String(val || "").trim())
    .map(([key, val]) => `<span>${escapeHtml(key)}: ${escapeHtml(val)}</span>`)
    .join("");
}

function renderStats() {
  const accounts = getMergedAccounts();

  setText("totalAccountsValue", accounts.length);
  setText("activeAccountsValue", accounts.filter((item) => item.accountStatus === "Active").length);
  setText("adminAccountsValue", accounts.filter((item) => item.role === "Admin").length);
  setText("staffAccountsValue", accounts.filter((item) => item.role === "Staff").length);
}

function countBy(items, getter, defaults = []) {
  const map = {};
  defaults.forEach((key) => {
    map[key] = 0;
  });

  items.forEach((item) => {
    const key = getter(item);
    map[key] = (map[key] || 0) + 1;
  });

  return map;
}

function renderCharts() {
  const accounts = getMergedAccounts();

  renderBarChart(
    "statusChart",
    countBy(accounts, (item) => item.accountStatus, ACCOUNT_STATUSES),
    chartColor
  );

  renderBarChart(
    "roleChart",
    countBy(accounts, (item) => item.role, ACCOUNT_ROLES),
    chartColor
  );

  renderBarChart(
    "sourceChart",
    countBy(accounts, (item) => item.source),
    chartColor
  );

  renderTrendChart(accounts);
}

function chartColor(label) {
  const clean = normalize(label);

  if (clean.includes("active")) return COLORS.green;
  if (clean.includes("inactive")) return COLORS.red;
  if (clean.includes("suspended")) return COLORS.orange;
  if (clean.includes("admin")) return COLORS.gold;
  if (clean.includes("staff")) return COLORS.blue;
  if (clean.includes("login")) return COLORS.purple;
  if (clean.includes("users")) return COLORS.navy;

  return COLORS.navy;
}

function renderBarChart(id, map, colorGetter) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(map)
    .filter(([key]) => key.trim())
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const total = entries.reduce((sum, [, val]) => sum + Number(val), 0);
  const max = Math.max(...entries.map(([, val]) => Number(val)), 0);

  if (!entries.length || total === 0) {
    container.innerHTML = `<div class="empty-chart">No chart data yet</div>`;
    return;
  }

  container.innerHTML = entries.slice(0, 6).map(([label, count]) => {
    const percent = total ? Math.round((Number(count) / total) * 100) : 0;
    const width = max ? Math.max(5, Math.round((Number(count) / max) * 100)) : 0;
    const color = colorGetter(label);

    return `
      <div class="chart-row">
        <div class="chart-row-head">
          <span>${escapeHtml(label)}</span>
          <strong>${count} (${percent}%)</strong>
        </div>
        <div class="chart-track">
          <div class="chart-fill" style="width:${width}%;background:${color};"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderTrendChart(accounts) {
  const container = $("createdTrendChart");
  if (!container) return;

  const now = new Date();
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    day.setDate(day.getDate() - i);
    days.push({
      date: day,
      label: shortDate(day),
      count: 0
    });
  }

  accounts.forEach((account) => {
    const created = toDate(account.createdAt);
    if (!created) return;

    const clean = new Date(created.getFullYear(), created.getMonth(), created.getDate());

    const match = days.find((day) => day.date.getTime() === clean.getTime());
    if (match) match.count += 1;
  });

  const max = Math.max(...days.map((day) => day.count), 1);

  container.innerHTML = days.map((day) => {
    const height = Math.max(5, Math.round((day.count / max) * 100));

    return `
      <div class="trend-bar">
        <strong>${day.count}</strong>
        <div class="trend-fill-wrap">
          <div class="trend-fill" style="height:${height}%;"></div>
        </div>
        <span>${escapeHtml(day.label)}</span>
      </div>
    `;
  }).join("");
}

function renderAccountsTable() {
  const body = $("staffAccountsBody");
  const summary = $("tableSummary");
  if (!body) return;

  const accounts = filteredAccounts();

  if (!accounts.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="empty-row">No login accounts found.</td>
      </tr>
    `;
    if (summary) summary.textContent = "Showing 0 login accounts";
    return;
  }

  body.innerHTML = accounts.map((account) => {
    const statusActionIcon = account.accountStatus === "Active"
      ? "fa-ban"
      : "fa-circle-check";

    const statusActionClass = account.accountStatus === "Active"
      ? "danger"
      : "green";

    const statusActionTitle = account.accountStatus === "Active"
      ? "Deactivate account"
      : "Activate account";

    return `
      <tr>
        <td>
          <div class="name-cell">
            <div class="account-avatar">${escapeHtml(getInitials(account.staffName))}</div>
            <div class="account-text">
              <strong>${escapeHtml(account.staffName)}</strong>
              <span>${escapeHtml(account.role)}</span>
            </div>
          </div>
        </td>

        <td>${escapeHtml(account.email)}</td>

        <td>
          <span class="role-chip ${escapeHtml(normalize(account.role))}">
            ${escapeHtml(account.role)}
          </span>
        </td>

        <td>
          <span class="status-chip ${escapeHtml(normalize(account.accountStatus))}">
            ${escapeHtml(account.accountStatus)}
          </span>
        </td>

        <td>
          <span class="source-chip">${escapeHtml(account.source)}</span>
        </td>

        <td>${escapeHtml(formatDateTime(account.lastLoginAt))}</td>

        <td>
          <div class="action-cell">
            <button class="action-btn" type="button" title="View account" data-open-account="${escapeHtml(account.uid)}">
              <i class="fa-regular fa-eye"></i>
            </button>

            <button class="action-btn" type="button" title="Edit account" data-edit-account="${escapeHtml(account.uid)}">
              <i class="fa-solid fa-pen"></i>
            </button>

            <button class="action-btn gold" type="button" title="Reset password" data-reset-password="${escapeHtml(account.uid)}">
              <i class="fa-solid fa-lock"></i>
            </button>

            <button class="action-btn ${statusActionClass}" type="button" title="${statusActionTitle}" data-toggle-status="${escapeHtml(account.uid)}">
              <i class="fa-solid ${statusActionIcon}"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (summary) summary.textContent = `Showing ${accounts.length} login accounts`;
}

/* CREATE ACCOUNT */

async function createFirebaseAuthUser(email, password, displayName) {
  const appName = `secondaryAccountCreator${Date.now()}${Math.floor(Math.random() * 9999)}`;
  let secondaryApp = null;

  try {
    secondaryApp = initializeApp(auth.app.options, appName);
    const secondaryAuth = getAuth(secondaryApp);

    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password
    );

    await updateProfile(credential.user, {
      displayName
    });

    const uid = credential.user?.uid || "";

    await signOut(secondaryAuth);

    return uid;
  } finally {
    if (secondaryApp) {
      try {
        await deleteApp(secondaryApp);
      } catch (error) {
        console.warn("Secondary app cleanup failed:", error);
      }
    }
  }
}

function credentialEmailText({ name, email, password, role }) {
  return `Hello ${name},

Your Lively Legacy login account has been created.

Login Role: ${role}
Email / Username: ${email}
Temporary Password: ${password}

Please login using the above credentials and change your password after first login.

Regards,
Lively Legacy Admin
`;
}

function credentialEmailHtml({ name, email, password, role }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1F2A44">
  <h2 style="margin:0 0 12px;color:#1F2A44">Lively Legacy Login Credentials</h2>
  <p>Hello <b>${escapeHtml(name)}</b>,</p>
  <p>Your Lively Legacy login account has been created.</p>
  <div style="background:#FAF8F4;border:1px solid #E8DDC8;border-radius:12px;padding:14px;margin:14px 0">
    <p style="margin:4px 0"><b>Login Role:</b> ${escapeHtml(role)}</p>
    <p style="margin:4px 0"><b>Email / Username:</b> ${escapeHtml(email)}</p>
    <p style="margin:4px 0"><b>Temporary Password:</b> ${escapeHtml(password)}</p>
  </div>
  <p>Please login using the above credentials and change your password after first login.</p>
  <p>Regards,<br><b>Lively Legacy Admin</b></p>
</div>
`;
}

async function queueCredentialEmail({ email, name, password, role, uid }) {
  const subject = "Your Lively Legacy Login Credentials";

  await addDoc(collection(db, COLLECTIONS.mail), {
    to: [email],
    message: {
      subject,
      text: credentialEmailText({ name, email, password, role }),
      html: credentialEmailHtml({ name, email, password, role })
    },
    metadata: {
      uid,
      role,
      type: "login_credentials",
      createdBy: auth.currentUser?.uid || "admin"
    },
    createdAt: serverTimestamp()
  });

  await addDoc(collection(db, COLLECTIONS.staffLoginEmailLogs), {
    uid,
    email,
    name,
    role,
    subject,
    status: "queued",
    type: "login_credentials",
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser?.uid || "admin"
  });
}

function validateCreateForm() {
  const employee = state.selectedEmployee;
  const role = value("loginRoleInput");
  const status = value("accountStatusInput");
  const name = value("staffNameInput");
  const email = value("emailInput").toLowerCase();
  const password = value("temporaryPasswordInput");
  const confirmPassword = value("confirmPasswordInput");

  if (!employee) {
    showToast("Search and select an employee first.", "error");
    return false;
  }

  if (!role || !ACCOUNT_ROLES.includes(role)) {
    showToast("Select a valid login role.", "error");
    return false;
  }

  if (!status || !ACCOUNT_STATUSES.includes(status)) {
    showToast("Select a valid account status.", "error");
    return false;
  }

  if (!name) {
    showToast("Employee name is required.", "error");
    return false;
  }

  if (!email || !email.includes("@") || !email.includes(".")) {
    showToast("Enter a valid email address.", "error");
    return false;
  }

  if (!password || password.length < 6) {
    showToast("Password must be at least 6 characters.", "error");
    return false;
  }

  if (password !== confirmPassword) {
    showToast("Temporary password and confirm password do not match.", "error");
    return false;
  }

  const duplicate = getMergedAccounts().some((account) => {
    return (
      normalize(account.uid) === normalize(employee.uid) ||
      normalize(account.email) === normalize(email) ||
      normalize(account.staffId) === normalize(employee.staffId)
    );
  });

  if (duplicate) {
    showToast("Login account already exists for this employee/email.", "error");
    return false;
  }

  return true;
}

async function createLoginAccount(event) {
  event.preventDefault();

  if (!validateCreateForm()) return;
  if (state.saving) return;

  state.saving = true;
  setCreateButton(true);

  try {
    const selectedEmployee = state.selectedEmployee;
    const role = value("loginRoleInput");
    const accountStatus = value("accountStatusInput");
    const email = value("emailInput").toLowerCase();
    const name = value("staffNameInput") || selectedEmployee.name;
    const password = value("temporaryPasswordInput");
    const staffId = firstNonEmpty([selectedEmployee.staffId, selectedEmployee.id], "");

    const uid = await createFirebaseAuthUser(email, password, name);

    if (!uid) {
      throw new Error("User account could not be created.");
    }

    const accountData = {
      uid,
      staffName: name,
      name,
      fullName: name,
      staffId,
      employeeId: selectedEmployee.id,
      employeeUid: selectedEmployee.uid,
      employeeSource: selectedEmployee.source,
      username: email,
      email,
      phone: selectedEmployee.phone,
      mobile: selectedEmployee.phone,
      department: selectedEmployee.department,
      propertyId: selectedEmployee.propertyId,
      propertyName: selectedEmployee.propertyName,
      propertyLocation: selectedEmployee.propertyName,
      shiftName: selectedEmployee.shiftName,
      shiftTiming: selectedEmployee.shiftTiming,
      role,
      accountStatus,
      loginStatus: accountStatus,
      status: accountStatus,
      isActive: accountStatus === "Active",
      isAdmin: role === "Admin",
      isSuperAdmin: false,
      permissions: permissionsForRole(role),
      sendCredentialsEmail: $("sendCredentialsEmailInput")?.checked || false,
      credentialEmailType: $("sendCredentialsEmailInput")?.checked
        ? "email_with_temporary_password"
        : "not_sent",
      temporaryPasswordCreated: true,
      source: "admin_settings",
      createdBy: auth.currentUser?.uid || "admin",
      lastLoginAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);

    batch.set(
      doc(db, COLLECTIONS.staffLoginAccounts, uid),
      accountData,
      { merge: true }
    );

    batch.set(
      doc(db, COLLECTIONS.users, uid),
      accountData,
      { merge: true }
    );

    if (role === "Staff") {
      batch.set(
        doc(db, COLLECTIONS.staff, uid),
        {
          uid,
          staffName: name,
          name,
          staffId,
          email,
          phone: selectedEmployee.phone,
          mobile: selectedEmployee.phone,
          department: selectedEmployee.department,
          propertyId: selectedEmployee.propertyId,
          propertyName: selectedEmployee.propertyName,
          shiftName: selectedEmployee.shiftName,
          shiftTiming: selectedEmployee.shiftTiming,
          role,
          accountStatus,
          status: accountStatus,
          isActive: accountStatus === "Active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    await batch.commit();

    let emailQueued = false;

    if ($("sendCredentialsEmailInput")?.checked) {
      try {
        await queueCredentialEmail({
          email,
          name,
          password,
          role,
          uid
        });

        emailQueued = true;
      } catch (emailError) {
        console.error("Credential email queue failed:", emailError);
      }
    }

    resetCreateForm();

    if ($("sendCredentialsEmailInput")?.checked) {
      showToast(
        emailQueued
          ? `Login account created. Email and password queued to ${email}.`
          : "Login account created, but credential email could not be queued.",
        emailQueued ? "success" : "error"
      );
    } else {
      showToast("Login account created successfully.");
    }
  } catch (error) {
    console.error("Create login account failed:", error);
    showToast(`Failed to create login account: ${error.message}`, "error");
  } finally {
    state.saving = false;
    setCreateButton(false);
  }
}

function setCreateButton(disabled) {
  const btn = $("createLoginBtn");
  if (!btn) return;

  btn.disabled = disabled;
  btn.innerHTML = disabled
    ? `<i class="fa-solid fa-spinner fa-spin"></i> Creating...`
    : `<i class="fa-solid fa-plus"></i> Create Login Account`;
}

function resetCreateForm() {
  $("staffLoginForm")?.reset();

  state.selectedEmployee = null;

  if ($("loginRoleInput")) $("loginRoleInput").value = "Staff";
  if ($("accountStatusInput")) $("accountStatusInput").value = "Active";
  if ($("sendCredentialsEmailInput")) $("sendCredentialsEmailInput").checked = true;

  clearSelectedEmployee();
  renderPage();
}

/* ACCOUNT ACTIONS */

async function updateAccountStatus(account, status) {
  try {
    const data = {
      accountStatus: status,
      loginStatus: status,
      status,
      isActive: status === "Active",
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);

    batch.set(doc(db, COLLECTIONS.staffLoginAccounts, account.uid), data, { merge: true });
    batch.set(doc(db, COLLECTIONS.users, account.uid), data, { merge: true });
    batch.set(doc(db, COLLECTIONS.staff, account.uid), data, { merge: true });

    await batch.commit();

    showToast(`${account.staffName} marked as ${status}.`);
    closeModal("accountDetailsModal");
  } catch (error) {
    console.error("Status update failed:", error);
    showToast(`Failed to update account status: ${error.message}`, "error");
  }
}

async function updateAccountDetails(account, name, role, status) {
  try {
    const data = {
      staffName: name,
      name,
      fullName: name,
      staffId: account.staffId,
      role,
      accountStatus: status,
      loginStatus: status,
      status,
      isActive: status === "Active",
      isAdmin: role === "Admin",
      isSuperAdmin: false,
      permissions: permissionsForRole(role),
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);

    batch.set(doc(db, COLLECTIONS.staffLoginAccounts, account.uid), data, { merge: true });
    batch.set(doc(db, COLLECTIONS.users, account.uid), data, { merge: true });
    batch.set(doc(db, COLLECTIONS.staff, account.uid), data, { merge: true });

    await batch.commit();

    showToast("Account updated successfully.");
    closeModal("editAccountModal");
  } catch (error) {
    console.error("Account update failed:", error);
    showToast(`Failed to update account: ${error.message}`, "error");
  }
}

async function resetPassword(account) {
  try {
    if (!account.email || account.email === "no email") {
      showToast("This account has no valid email.", "error");
      return;
    }

    await sendPasswordResetEmail(auth, account.email);

    showToast(`Password reset email sent to ${account.email}.`);
  } catch (error) {
    console.error("Reset password failed:", error);
    showToast(`Failed to send password reset email: ${error.message}`, "error");
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

function findAccount(uid) {
  return getMergedAccounts().find((account) => account.uid === uid) || null;
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function openAccountDetails(uid) {
  const account = findAccount(uid);
  if (!account) return;

  state.selectedDetailsUid = uid;

  setText("detailsTitle", account.staffName);
  setText("detailsSubtitle", account.email);

  const body = $("accountDetailsBody");
  if (!body) return;

  body.innerHTML = `
    ${detailLine("UID", account.uid)}
    ${detailLine("Name", account.staffName)}
    ${detailLine("Staff ID", account.staffId)}
    ${detailLine("Email", account.email)}
    ${detailLine("Role", account.role)}
    ${detailLine("Status", account.accountStatus)}
    ${detailLine("Source", account.source)}
    ${detailLine("Last Login", formatDateTime(account.lastLoginAt))}
    ${detailLine("Created On", formatDateTime(account.createdAt))}

    <div class="details-actions">
      <button class="primary-btn" type="button" data-status-from-details="Active">
        <i class="fa-solid fa-circle-check"></i>
        Activate
      </button>

      <button class="danger-btn" type="button" data-status-from-details="Inactive">
        <i class="fa-solid fa-ban"></i>
        Deactivate
      </button>

      <button class="danger-btn" type="button" data-status-from-details="Suspended">
        <i class="fa-solid fa-lock"></i>
        Suspend
      </button>

      <button class="secondary-btn" type="button" data-reset-password="${escapeHtml(account.uid)}">
        <i class="fa-solid fa-lock-open"></i>
        Reset Password
      </button>
    </div>
  `;

  openModal("accountDetailsModal");
}

function openEditAccount(uid) {
  const account = findAccount(uid);
  if (!account) return;

  state.selectedEditUid = uid;

  setText("editSubtitle", account.email);

  $("editNameInput").value = account.staffName;
  $("editRoleInput").value = account.role;
  $("editStatusInput").value = account.accountStatus;

  openModal("editAccountModal");
}

/* EMPLOYEE SELECTION */

function selectEmployee(id) {
  const employee = getEmployeeOptions().find((item) => item.id === id);
  if (!employee) return;

  state.selectedEmployee = employee;

  $("staffNameInput").value = employee.name;
  $("staffIdInput").value = employee.staffId;
  $("emailInput").value = employee.email && employee.email !== "no email" ? employee.email : "";
  $("employeeSearchInput").value = employee.displayLabel;

  renderPage();
}

function clearSelectedEmployee() {
  state.selectedEmployee = null;

  if ($("employeeSearchInput")) $("employeeSearchInput").value = "";
  if ($("staffNameInput")) $("staffNameInput").value = "";
  if ($("staffIdInput")) $("staffIdInput").value = "";
  if ($("emailInput")) $("emailInput").value = "";

  renderPage();
}

/* EVENTS */

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Settings refreshed.");
  });

  $("staffLoginForm")?.addEventListener("submit", createLoginAccount);

  $("loginRoleInput")?.addEventListener("change", () => {
    clearSelectedEmployee();
    renderEmployeeSearchLabel();
  });

  $("employeeSearchInput")?.addEventListener("input", () => {
    state.selectedEmployee = null;
    renderEmployeeResults();
    renderSelectedEmployeeCard();
  });

  $("clearEmployeeBtn")?.addEventListener("click", clearSelectedEmployee);

  $("employeeResults")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-employee-id]");
    if (!btn) return;

    selectEmployee(btn.dataset.employeeId);
  });

  $("staffSearchInput")?.addEventListener("input", renderAccountsTable);
  $("globalSearchInput")?.addEventListener("input", renderAccountsTable);
  $("statusFilterInput")?.addEventListener("change", renderAccountsTable);

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

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal(overlay.id);
    });
  });

  document.addEventListener("click", async (event) => {
    const openBtn = event.target.closest("[data-open-account]");
    if (openBtn) {
      openAccountDetails(openBtn.dataset.openAccount);
      return;
    }

    const editBtn = event.target.closest("[data-edit-account]");
    if (editBtn) {
      openEditAccount(editBtn.dataset.editAccount);
      return;
    }

    const resetBtn = event.target.closest("[data-reset-password]");
    if (resetBtn) {
      const account = findAccount(resetBtn.dataset.resetPassword);
      if (account) await resetPassword(account);
      return;
    }

    const toggleBtn = event.target.closest("[data-toggle-status]");
    if (toggleBtn) {
      const account = findAccount(toggleBtn.dataset.toggleStatus);
      if (!account) return;

      const newStatus = account.accountStatus === "Active" ? "Inactive" : "Active";
      await updateAccountStatus(account, newStatus);
      return;
    }

    const detailsStatusBtn = event.target.closest("[data-status-from-details]");
    if (detailsStatusBtn) {
      const account = findAccount(state.selectedDetailsUid);
      if (!account) return;

      await updateAccountStatus(account, detailsStatusBtn.dataset.statusFromDetails);
    }
  });

  $("detailsResetPasswordBtn")?.addEventListener("click", async () => {
    const account = findAccount(state.selectedDetailsUid);
    if (account) await resetPassword(account);
  });

  $("editAccountForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const account = findAccount(state.selectedEditUid);
    if (!account) return;

    const name = value("editNameInput");
    const role = value("editRoleInput");
    const status = value("editStatusInput");

    if (!name) {
      showToast("Name is required.", "error");
      return;
    }

    await updateAccountDetails(account, name, role, status);
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});