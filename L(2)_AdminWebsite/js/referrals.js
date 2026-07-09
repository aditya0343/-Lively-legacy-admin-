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
  writeBatch,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  referrals: "referrals",
  residents: "residents",
  users: "users",
  properties: "properties",
  billingAdjustments: "billing_adjustments"
};

const BOOKING_STATUSES = [
  "Lead Created",
  "Booking Confirmed",
  "Moved In",
  "Converted",
  "Cancelled"
];

const REWARD_STATUSES = [
  "Not Eligible",
  "Pending Approval",
  "Approved",
  "Adjusted",
  "Paid",
  "Rejected"
];

const COLORS = {
  navy: "#061b32",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  blue: "#2f80ed",
  orange: "#e18a00",
  purple: "#6352c7",
  grey: "#667085"
};

const state = {
  referrals: [],
  residents: [],
  users: [],
  properties: [],
  selectedReferralId: "",
  savingReferral: false,
  savingAction: false,
  unsubscribers: []
};

const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value;
};

const normalize = (value) => String(value || "").toLowerCase().trim();

const escapeHtml = (value) => String(value || "")
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

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (amount <= 0) return "-";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
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

/* AUTH + LAYOUT */

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

  profileDropdown?.addEventListener("click", (event) => event.stopPropagation());

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
    }
  });
}

/* FIREBASE */

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
      console.error(`${collectionName} failed:`, error);
      state[stateKey] = [];
      renderPage();
      showToast(`${collectionName} failed: ${error.message}`, "error");
    }
  );

  state.unsubscribers.push(unsubscribe);
}

function setupFirebase() {
  listenCollection("referrals", COLLECTIONS.referrals);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("properties", COLLECTIONS.properties);
}

/* FORM OPTIONS */

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

  function addResident(item) {
    const propertyId = firstNonEmpty([item.propertyId, item.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(item.id, {
      id: item.id,
      name: firstNonEmpty([item.name, item.fullName, item.residentName, item.displayName], item.id),
      phone: firstNonEmpty([item.phone, item.mobile], ""),
      email: firstNonEmpty([item.email], ""),
      propertyId,
      propertyName: firstNonEmpty([item.propertyName, item.property], property?.name || ""),
      roomNo: firstNonEmpty([item.roomNo, item.roomNumber, item.bedNo, item.unit], "")
    });
  }

  state.residents.forEach(addResident);

  state.users.forEach((user) => {
    if (map.has(user.id)) return;

    const role = normalize(user.role || user.userRole || user.type);
    if (!role || ["resident", "tenant", "student"].includes(role)) {
      addResident(user);
    }
  });

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findResident(id) {
  return getResidentOptions().find((item) => item.id === id) || null;
}

function findProperty(id) {
  return getPropertyOptions().find((item) => item.id === id) || null;
}

/* NORMALIZE */

function normalizeBookingStatus(value) {
  const clean = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (clean === "lead created" || clean === "new") return "Lead Created";
  if (clean === "booking confirmed") return "Booking Confirmed";
  if (clean === "moved in") return "Moved In";
  if (clean === "converted") return "Converted";
  if (clean === "cancelled" || clean === "canceled") return "Cancelled";

  return "Lead Created";
}

function normalizeRewardStatus(value) {
  const clean = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (clean === "not eligible") return "Not Eligible";
  if (clean === "pending approval" || clean === "pending") return "Pending Approval";
  if (clean === "approved") return "Approved";
  if (clean === "adjusted") return "Adjusted";
  if (clean === "paid") return "Paid";
  if (clean === "rejected" || clean === "declined") return "Rejected";

  return "Not Eligible";
}

function statusClass(value) {
  return normalize(value).replaceAll(" ", "-");
}

function bookingStatusColor(value) {
  const status = normalizeBookingStatus(value);

  if (status === "Lead Created") return COLORS.blue;
  if (status === "Booking Confirmed") return COLORS.orange;
  if (status === "Moved In") return COLORS.green;
  if (status === "Converted") return COLORS.green;
  if (status === "Cancelled") return COLORS.red;

  return COLORS.navy;
}

function rewardStatusColor(value) {
  const status = normalizeRewardStatus(value);

  if (status === "Not Eligible") return COLORS.grey;
  if (status === "Pending Approval") return COLORS.orange;
  if (status === "Approved") return COLORS.blue;
  if (status === "Adjusted") return COLORS.green;
  if (status === "Paid") return COLORS.green;
  if (status === "Rejected") return COLORS.red;

  return COLORS.navy;
}

function propertyColor(value) {
  const colors = [COLORS.blue, COLORS.green, COLORS.orange, COLORS.purple, COLORS.red, COLORS.gold];
  const hash = String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/* REFERRAL GETTERS */

function getReferrerId(item) {
  return firstNonEmpty([item.referrerId, item.referredById, item.residentId], "");
}

function getReferredToId(item) {
  return firstNonEmpty([item.referredToId, item.referredUserId, item.leadResidentId, item.referredResidentId], "");
}

function getReferrer(item) {
  return findResident(getReferrerId(item));
}

function getReferredTo(item) {
  return findResident(getReferredToId(item));
}

function getReferralCode(item) {
  return firstNonEmpty([item.referralCode, item.code], item.id).toUpperCase();
}

function getReferrerName(item) {
  return firstNonEmpty([item.referrerName, item.referredByName], getReferrer(item)?.name || "Referrer");
}

function getReferrerPhone(item) {
  return firstNonEmpty([item.referrerPhone, item.referredByPhone], getReferrer(item)?.phone || "");
}

function getReferredToName(item) {
  return firstNonEmpty([item.referredToName, item.referredName, item.leadName], getReferredTo(item)?.name || "Referred Resident");
}

function getReferredToPhone(item) {
  return firstNonEmpty([item.referredToPhone, item.leadPhone], getReferredTo(item)?.phone || "");
}

function getPropertyId(item) {
  return firstNonEmpty([item.propertyId, item.property_id], "");
}

function getPropertyNameForReferral(item) {
  const propertyMap = getPropertyMap();
  const referredTo = getReferredTo(item);
  const property = propertyMap.get(getPropertyId(item));

  return firstNonEmpty([item.propertyName, item.property], property?.name || referredTo?.propertyName || "No Property");
}

function getUnit(item) {
  const referredTo = getReferredTo(item);

  return firstNonEmpty([item.unit, item.roomNo, item.roomNumber, item.bedNo], referredTo?.roomNo || "");
}

function getBookingStatus(item) {
  return normalizeBookingStatus(firstNonEmpty([item.bookingStatus, item.status], "Lead Created"));
}

function getRewardStatus(item) {
  const bookingStatus = getBookingStatus(item);

  return normalizeRewardStatus(
    firstNonEmpty([
      item.rewardStatus,
      bookingStatus === "Moved In" ? "Pending Approval" : "Not Eligible"
    ])
  );
}

function getRewardAmount(item) {
  return Number(item.rewardAmount || item.customRewardAmount || item.amount || 0);
}

function getRewardAppliedMonth(item) {
  return firstNonEmpty([item.rewardAppliedMonth, item.applyMonth], "");
}

function getRewardAdjustmentId(item) {
  return firstNonEmpty([item.rewardAdjustmentId, item.adjustmentId], "");
}

function getNotes(item) {
  return firstNonEmpty([item.notes, item.rewardNotes], "");
}

function getReferredOn(item) {
  return firstNonEmpty([item.referredOn, item.createdAt], "");
}

function getCreatedAt(item) {
  return item.createdAt || "";
}

function getMovedInAt(item) {
  return item.movedInAt || "";
}

function getRewardApprovedAt(item) {
  return item.rewardApprovedAt || "";
}

/* RENDER */

function renderPage() {
  renderFilterOptions();
  renderStats();
  renderAnalytics();
  renderReferralList();
  renderApprovalPanel();
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
    ...new Set(state.referrals.map(getPropertyNameForReferral).filter(Boolean))
  ];

  const bookingStatuses = [
    "All Booking Status",
    ...new Set([
      ...BOOKING_STATUSES,
      ...state.referrals.map(getBookingStatus)
    ])
  ];

  const rewardStatuses = [
    "All Reward Status",
    ...new Set([
      ...REWARD_STATUSES,
      ...state.referrals.map(getRewardStatus)
    ])
  ];

  updateSelect("propertyFilter", properties);
  updateSelect("bookingStatusFilter", bookingStatuses);
  updateSelect("rewardStatusFilter", rewardStatuses);
}

function renderStats() {
  const totalReferrals = state.referrals.length;

  const convertedReferrals = state.referrals.filter((item) => {
    const status = getBookingStatus(item);
    return status === "Moved In" || status === "Converted";
  }).length;

  const rewardsPending = state.referrals.filter((item) => {
    return getRewardStatus(item) === "Pending Approval";
  }).length;

  const rewardsPaid = state.referrals.filter((item) => {
    const status = getRewardStatus(item);
    return status === "Paid" || status === "Adjusted";
  }).length;

  const totalRewards = state.referrals.reduce((sum, item) => {
    const status = getRewardStatus(item);

    if (status === "Approved" || status === "Adjusted" || status === "Paid") {
      return sum + getRewardAmount(item);
    }

    return sum;
  }, 0);

  setText("totalReferralsValue", totalReferrals);
  setText("convertedReferralsValue", convertedReferrals);
  setText("totalRewardsValue", formatMoney(totalRewards));
  setText("pendingRewardsValue", rewardsPending);
  setText("paidRewardsValue", rewardsPaid);
}

function countBy(items, getter) {
  const map = {};

  items.forEach((item) => {
    const key = getter(item) || "Not Added";
    map[key] = (map[key] || 0) + 1;
  });

  return map;
}

function renderAnalytics() {
  renderBookingDonut();
  renderBarChart(
    "rewardStatusChart",
    countBy(state.referrals, getRewardStatus),
    rewardStatusColor,
    (value) => value.toString()
  );
  renderRewardAmountChart();
  renderBarChart(
    "propertyReferralChart",
    countBy(state.referrals, getPropertyNameForReferral),
    propertyColor,
    (value) => value.toString()
  );
}

function renderBookingDonut() {
  const chart = $("bookingDonutChart");
  const legend = $("bookingLegendList");
  if (!chart || !legend) return;

  const map = countBy(state.referrals, getBookingStatus);
  const entries = BOOKING_STATUSES
    .map((status) => [status, map[status] || 0])
    .filter(([, value]) => value > 0);

  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  setText("donutTotalValue", total);

  if (!total) {
    chart.style.background = "conic-gradient(#e5e7eb 0deg 360deg)";
    legend.innerHTML = `<div class="empty-state small">No referral data yet.</div>`;
    return;
  }

  let start = 0;
  const segments = entries.map(([label, value]) => {
    const degrees = (value / total) * 360;
    const end = start + degrees;
    const color = bookingStatusColor(label);
    const segment = `${color} ${start}deg ${end}deg`;
    start = end;
    return segment;
  });

  chart.style.background = `conic-gradient(${segments.join(",")})`;

  legend.innerHTML = entries.map(([label, value]) => {
    const color = bookingStatusColor(label);

    return `
      <div class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span>${escapeHtml(label)}: <strong>${value}</strong></span>
      </div>
    `;
  }).join("");
}

function renderBarChart(id, map, colorGetter, formatter) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(map)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 8);

  const max = Math.max(...entries.map(([, value]) => Number(value)), 0);

  if (!entries.length || !max) {
    container.innerHTML = `<div class="empty-state small">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value]) => {
    const numericValue = Number(value);
    const width = Math.max(8, Math.round((numericValue / max) * 100));
    const color = colorGetter(label);

    return `
      <div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color}"></div>
        </div>
        <strong>${escapeHtml(formatter(numericValue))}</strong>
      </div>
    `;
  }).join("");
}

function renderRewardAmountChart() {
  const map = {};

  state.referrals.forEach((item) => {
    const amount = getRewardAmount(item);
    if (amount <= 0) return;

    const status = getRewardStatus(item);
    map[status] = (map[status] || 0) + amount;
  });

  renderBarChart(
    "rewardAmountChart",
    map,
    rewardStatusColor,
    formatMoney
  );
}

function getFilteredReferrals() {
  let items = [...state.referrals];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("referralSearchInput")?.value);
  const search = localSearch || globalSearch;
  const property = $("propertyFilter")?.value || "All Properties";
  const bookingStatus = $("bookingStatusFilter")?.value || "All Booking Status";
  const rewardStatus = $("rewardStatusFilter")?.value || "All Reward Status";

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        getReferralCode(item),
        getReferrerName(item),
        getReferrerPhone(item),
        getReferredToName(item),
        getReferredToPhone(item),
        getPropertyNameForReferral(item),
        getUnit(item),
        getBookingStatus(item),
        getRewardStatus(item)
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (property !== "All Properties") {
    items = items.filter((item) => getPropertyNameForReferral(item) === property);
  }

  if (bookingStatus !== "All Booking Status") {
    items = items.filter((item) => getBookingStatus(item) === bookingStatus);
  }

  if (rewardStatus !== "All Reward Status") {
    items = items.filter((item) => getRewardStatus(item) === rewardStatus);
  }

  items.sort((a, b) => {
    const rankA = referralSortRank(a);
    const rankB = referralSortRank(b);

    if (rankA !== rankB) return rankA - rankB;

    const aDate = toDate(getCreatedAt(a))?.getTime() || 0;
    const bDate = toDate(getCreatedAt(b))?.getTime() || 0;

    return bDate - aDate;
  });

  return items;
}

function referralSortRank(item) {
  const bookingStatus = getBookingStatus(item);
  const rewardStatus = getRewardStatus(item);

  if (bookingStatus === "Moved In" && rewardStatus === "Pending Approval") return 1;
  if (bookingStatus === "Moved In") return 2;
  if (bookingStatus === "Booking Confirmed") return 3;
  if (bookingStatus === "Lead Created") return 4;
  if (rewardStatus === "Rejected") return 5;

  return 6;
}

function renderReferralList() {
  const container = $("referralList");
  if (!container) return;

  const items = getFilteredReferrals();

  setText("tableSummary", `${items.length} referral records shown`);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">No referrals found. Referral records will appear here when added.</div>`;
    return;
  }

  container.innerHTML = items.map((item) => {
    const bookingStatus = getBookingStatus(item);
    const rewardStatus = getRewardStatus(item);

    return `
      <article class="referral-card">
        <div class="avatar-box">${escapeHtml(getInitials(getReferrerName(item)))}</div>

        <div class="row-text">
          <strong>${escapeHtml(getReferrerName(item))}</strong>
          <span>${escapeHtml(getReferrerPhone(item) || "No phone")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getReferralCode(item))}</strong>
          <span>Referral Code</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getReferredToName(item))}</strong>
          <span>${escapeHtml(getReferredToPhone(item) || "No phone")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getPropertyNameForReferral(item))}</strong>
          <span>${escapeHtml(getUnit(item) || "No unit")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatMoney(getRewardAmount(item)))}</strong>
          <span>${escapeHtml(getRewardAppliedMonth(item) || "No applied month")}</span>
        </div>

        <div>
          <span class="status-chip ${statusClass(bookingStatus)}">${escapeHtml(bookingStatus)}</span>
          <span class="status-chip ${statusClass(rewardStatus)}" style="margin-top:6px;">${escapeHtml(rewardStatus)}</span>
        </div>

        <div class="row-actions">
          <button type="button" title="View / Approve reward" data-view-referral="${escapeHtml(item.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <select data-booking-status="${escapeHtml(item.id)}">
            ${BOOKING_STATUSES.map((status) => `
              <option value="${escapeHtml(status)}" ${status === bookingStatus ? "selected" : ""}>
                ${escapeHtml(status)}
              </option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

function renderApprovalPanel() {
  const container = $("approvalList");
  if (!container) return;

  const pending = state.referrals.filter((item) => {
    const bookingStatus = getBookingStatus(item);
    const rewardStatus = getRewardStatus(item);

    return (
      bookingStatus === "Moved In" &&
      !["Approved", "Paid", "Adjusted", "Rejected"].includes(rewardStatus)
    );
  });

  if (!pending.length) {
    container.innerHTML = `<div class="empty-state small">No reward approval pending. Moved-in referrals awaiting reward will appear here.</div>`;
    return;
  }

  container.innerHTML = pending.slice(0, 5).map((item) => {
    return `
      <div class="approval-mini">
        <strong>${escapeHtml(getReferralCode(item))}</strong>
        <p>${escapeHtml(getReferrerName(item))} → ${escapeHtml(getReferredToName(item))}</p>
        <p>${escapeHtml(getPropertyNameForReferral(item))} ${getUnit(item) ? `- ${escapeHtml(getUnit(item))}` : ""}</p>
        <p>Reward: <strong>${escapeHtml(formatMoney(getRewardAmount(item)))}</strong></p>
        <button type="button" data-view-referral="${escapeHtml(item.id)}">
          <i class="fa-solid fa-check"></i>
          Review Reward
        </button>
      </div>
    `;
  }).join("");
}

/* ADD REFERRAL */

function generateReferralCode(name, id) {
  const cleanName = String(name || "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .padEnd(4, "X")
    .slice(0, 4);

  const cleanId = String(id || "").toUpperCase().slice(0, 4);

  return `${cleanName}${cleanId}`;
}

function fillFormOptions() {
  const referrerInput = $("referrerInput");
  const referredToInput = $("referredToInput");
  const propertyInput = $("referralPropertyInput");

  if (referrerInput) referrerInput.innerHTML = `<option value="">Select referrer</option>`;
  if (referredToInput) referredToInput.innerHTML = `<option value="">Select referred resident</option>`;
  if (propertyInput) propertyInput.innerHTML = `<option value="">Select property</option>`;

  getResidentOptions().forEach((resident) => {
    const label = `${resident.name}${resident.roomNo ? ` - ${resident.roomNo}` : resident.phone ? ` - ${resident.phone}` : ""}`;

    if (referrerInput) {
      const option = document.createElement("option");
      option.value = resident.id;
      option.textContent = label;
      referrerInput.appendChild(option);
    }

    if (referredToInput) {
      const option = document.createElement("option");
      option.value = resident.id;
      option.textContent = label;
      referredToInput.appendChild(option);
    }
  });

  getPropertyOptions().forEach((property) => {
    if (!propertyInput) return;

    const option = document.createElement("option");
    option.value = property.id;
    option.textContent = property.name;
    propertyInput.appendChild(option);
  });
}

function openAddReferralModal() {
  $("referralForm")?.reset();
  fillFormOptions();

  $("rewardAmountFormInput").value = "5000";
  $("bookingStatusInput").value = "Lead Created";
  $("rewardStatusInput").value = "Not Eligible";

  openModal("referralModal");
}

async function saveReferral(event) {
  event.preventDefault();

  if (state.savingReferral) return;

  const form = $("referralForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const referrer = findResident($("referrerInput").value);
  const referredTo = findResident($("referredToInput").value);

  if (!referrer || !referredTo) {
    showToast("Selected resident not found.", "error");
    return;
  }

  if (referrer.id === referredTo.id) {
    showToast("Referrer and referred to cannot be same.", "error");
    return;
  }

  const property = findProperty($("referralPropertyInput").value);
  const ref = doc(collection(db, COLLECTIONS.referrals));

  const cleanCode = $("referralCodeInput").value.trim()
    ? $("referralCodeInput").value.trim().toUpperCase()
    : generateReferralCode(referrer.name, ref.id);

  state.savingReferral = true;
  $("saveReferralBtn").disabled = true;
  $("saveReferralBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    await setDoc(ref, {
      referralId: ref.id,
      referralCode: cleanCode,
      referrerId: referrer.id,
      referrerName: referrer.name,
      referrerPhone: referrer.phone,
      referredToId: referredTo.id,
      referredToName: referredTo.name,
      referredToPhone: referredTo.phone,
      propertyId: property?.id || referredTo.propertyId,
      propertyName: property?.name || referredTo.propertyName,
      unit: referredTo.roomNo,
      leadStatus: $("bookingStatusInput").value,
      bookingStatus: $("bookingStatusInput").value,
      status: $("bookingStatusInput").value,
      rewardAmount: Number($("rewardAmountFormInput").value || 0),
      rewardStatus: $("rewardStatusInput").value,
      rewardAppliedMonth: "",
      rewardAdjustmentId: "",
      notes: $("referralNotesInput").value.trim(),
      source: "admin_website",
      createdBy: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Referral saved successfully.");
    closeModal("referralModal");
  } catch (error) {
    console.error("Save referral failed:", error);
    showToast(`Failed to save referral: ${error.message}`, "error");
  } finally {
    state.savingReferral = false;
    $("saveReferralBtn").disabled = false;
    $("saveReferralBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Referral`;
  }
}

/* STATUS + REWARD */

async function updateReferralStatus(referralId, bookingStatus) {
  const referral = state.referrals.find((item) => item.id === referralId);
  if (!referral) return;

  try {
    const data = {
      bookingStatus,
      status: bookingStatus,
      leadStatus: bookingStatus,
      updatedAt: serverTimestamp()
    };

    if (bookingStatus === "Moved In") {
      data.movedInAt = serverTimestamp();

      const currentReward = getRewardStatus(referral);
      if (currentReward === "Not Eligible" || currentReward === "Rejected") {
        data.rewardStatus = "Pending Approval";
      }
    }

    if (bookingStatus === "Booking Confirmed") {
      data.bookingConfirmedAt = serverTimestamp();
    }

    if (bookingStatus === "Cancelled") {
      data.cancelledAt = serverTimestamp();
      data.rewardStatus = "Not Eligible";
    }

    await setDoc(doc(db, COLLECTIONS.referrals, referralId), data, { merge: true });
    showToast(`Referral status updated to ${bookingStatus}.`);
  } catch (error) {
    console.error("Referral status update failed:", error);
    showToast(`Failed to update referral: ${error.message}`, "error");
  }
}

function nextBillingMonth(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return next.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric"
  });
}

async function approveReward(referralId, amount, notes) {
  const referral = state.referrals.find((item) => item.id === referralId);
  if (!referral) return false;

  if (Number(amount) <= 0) {
    showToast("Enter reward amount greater than 0.", "error");
    return false;
  }

  if (getBookingStatus(referral) !== "Moved In") {
    showToast("Reward can be approved only after referred resident is moved in.", "error");
    return false;
  }

  try {
    const nextMonth = nextBillingMonth();
    const adjustmentRef = doc(collection(db, COLLECTIONS.billingAdjustments));
    const batch = writeBatch(db);

    batch.set(
      doc(db, COLLECTIONS.referrals, referral.id),
      {
        rewardAmount: Number(amount),
        rewardStatus: "Approved",
        rewardApprovedAt: serverTimestamp(),
        rewardAppliedMonth: nextMonth,
        rewardAdjustmentId: adjustmentRef.id,
        rewardNotes: notes.trim(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    batch.set(adjustmentRef, {
      adjustmentId: adjustmentRef.id,
      type: "Referral Reward Credit",
      adjustmentType: "Referral Reward Credit",
      residentId: getReferrerId(referral),
      residentName: getReferrerName(referral),
      propertyId: getPropertyId(referral),
      propertyName: getPropertyNameForReferral(referral),
      referralId: referral.id,
      referralCode: getReferralCode(referral),
      referredToId: getReferredToId(referral),
      referredToName: getReferredToName(referral),
      amount: Number(amount),
      creditAmount: Number(amount),
      debitAmount: 0,
      applyMonth: nextMonth,
      status: "Pending Adjustment",
      billingStatus: "Pending Adjustment",
      description: `Referral reward credit for ${getReferredToName(referral)}. Auto adjust in next month bill.`,
      notes: notes.trim(),
      source: "referral_management",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const referrerId = getReferrerId(referral);

    if (referrerId) {
      batch.set(
        doc(db, COLLECTIONS.residents, referrerId),
        {
          nextBillCredit: increment(Number(amount)),
          referralRewardBalance: increment(Number(amount)),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      batch.set(
        doc(db, COLLECTIONS.users, referrerId),
        {
          nextBillCredit: increment(Number(amount)),
          referralRewardBalance: increment(Number(amount)),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    await batch.commit();

    showToast(`Reward approved. ${formatMoney(amount)} will adjust in ${nextMonth} bill.`);
    return true;
  } catch (error) {
    console.error("Approve reward failed:", error);
    showToast(`Failed to approve reward: ${error.message}`, "error");
    return false;
  }
}

async function declineReward(referralId, notes) {
  const referral = state.referrals.find((item) => item.id === referralId);
  if (!referral) return false;

  try {
    await setDoc(
      doc(db, COLLECTIONS.referrals, referral.id),
      {
        rewardStatus: "Rejected",
        rewardRejectedAt: serverTimestamp(),
        rewardNotes: notes.trim(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast("Referral reward declined.");
    return true;
  } catch (error) {
    console.error("Decline reward failed:", error);
    showToast(`Failed to decline reward: ${error.message}`, "error");
    return false;
  }
}

/* DETAIL MODAL */

function openReferralDetail(referralId) {
  const item = state.referrals.find((referral) => referral.id === referralId);
  if (!item) return;

  const content = $("detailContent");
  if (!content) return;

  const bookingStatus = getBookingStatus(item);
  const rewardStatus = getRewardStatus(item);
  const nextMonth = nextBillingMonth();

  content.innerHTML = `
    <h3>Referral Details</h3>

    <div class="detail-grid">
      ${detailLine("Referral Code", getReferralCode(item))}
      ${detailLine("Referral / Referred By", getReferrerName(item))}
      ${detailLine("Referrer Phone", getReferrerPhone(item) || "-")}
      ${detailLine("Referred To", getReferredToName(item))}
      ${detailLine("Referred To Phone", getReferredToPhone(item) || "-")}
      ${detailLine("Property / Unit", `${getPropertyNameForReferral(item)} - ${getUnit(item) || "-"}`)}
      ${detailLine("Booking Status", bookingStatus)}
      ${detailLine("Reward Status", rewardStatus)}
      ${detailLine("Current Reward", formatMoney(getRewardAmount(item)))}
      ${detailLine("Applied Month", getRewardAppliedMonth(item) || "-")}
      ${detailLine("Next Bill Month", nextMonth)}
      ${detailLine("Referred On", formatDate(getReferredOn(item)))}
      ${detailLine("Moved In At", formatDate(getMovedInAt(item)))}
      ${detailLine("Reward Approved At", formatDate(getRewardApprovedAt(item)))}
    </div>

    <label>
      <span>Custom Reward Amount</span>
      <input id="detailRewardAmountInput" type="number" min="0" value="${escapeHtml(getRewardAmount(item) || 5000)}" />
    </label>

    <label>
      <span>Notes / Remarks</span>
      <textarea id="detailRewardNotesInput" rows="3" placeholder="Add notes for approval or rejection">${escapeHtml(getNotes(item))}</textarea>
    </label>

    ${bookingStatus !== "Moved In" ? `
      <div class="detail-actions" style="grid-template-columns:1fr;">
        <button type="button" class="outline-btn" data-mark-moved-in="${escapeHtml(item.id)}">
          <i class="fa-solid fa-right-to-bracket"></i>
          Mark Referred To as Moved In
        </button>
      </div>
    ` : ""}

    <div class="detail-actions">
      <button type="button" class="green-btn" data-approve-reward="${escapeHtml(item.id)}">
        <i class="fa-solid fa-check"></i>
        Approve
      </button>

      <button type="button" class="red-btn" data-decline-reward="${escapeHtml(item.id)}">
        <i class="fa-solid fa-xmark"></i>
        Decline
      </button>
    </div>

    <p style="margin-top:14px;color:rgba(6,27,50,.56);font-size:11px;font-weight:750;line-height:1.4;">
      After approval, this creates a billing_adjustments credit for the referrer. Your billing screen should subtract this credit from the next month bill.
    </p>
  `;

  openModal("detailModal");
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
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
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Referral Management refreshed.");
  });

  $("openReferralModalBtn")?.addEventListener("click", openAddReferralModal);
  $("referralForm")?.addEventListener("submit", saveReferral);

  $("referredToInput")?.addEventListener("change", () => {
    const resident = findResident($("referredToInput").value);

    if (resident && resident.propertyId) {
      $("referralPropertyInput").value = resident.propertyId;
    }
  });

  $("bookingStatusInput")?.addEventListener("change", () => {
    const value = $("bookingStatusInput").value;

    if (value === "Moved In") {
      $("rewardStatusInput").value = "Pending Approval";
    } else if (value === "Cancelled") {
      $("rewardStatusInput").value = "Not Eligible";
    }
  });

  [
    "globalSearchInput",
    "referralSearchInput",
    "propertyFilter",
    "bookingStatusFilter",
    "rewardStatusFilter"
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", renderReferralList);
    element.addEventListener("change", renderReferralList);
  });

  $("resetFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("referralSearchInput").value = "";
    $("propertyFilter").value = "All Properties";
    $("bookingStatusFilter").value = "All Booking Status";
    $("rewardStatusFilter").value = "All Reward Status";
    renderReferralList();
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(button.dataset.closeModal);
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal(overlay.id);
    });
  });

  document.addEventListener("click", async (event) => {
    const viewBtn = event.target.closest("[data-view-referral]");
    if (viewBtn) {
      openReferralDetail(viewBtn.dataset.viewReferral);
      return;
    }

    const markMovedBtn = event.target.closest("[data-mark-moved-in]");
    if (markMovedBtn) {
      await updateReferralStatus(markMovedBtn.dataset.markMovedIn, "Moved In");
      closeModal("detailModal");
      return;
    }

    const approveBtn = event.target.closest("[data-approve-reward]");
    if (approveBtn) {
      if (state.savingAction) return;

      state.savingAction = true;
      approveBtn.disabled = true;
      approveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

      const amount = Number($("detailRewardAmountInput")?.value || 0);
      const notes = $("detailRewardNotesInput")?.value || "";

      const ok = await approveReward(approveBtn.dataset.approveReward, amount, notes);

      state.savingAction = false;
      if (ok) closeModal("detailModal");

      return;
    }

    const declineBtn = event.target.closest("[data-decline-reward]");
    if (declineBtn) {
      if (state.savingAction) return;

      state.savingAction = true;
      declineBtn.disabled = true;
      declineBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

      const notes = $("detailRewardNotesInput")?.value || "";
      const ok = await declineReward(declineBtn.dataset.declineReward, notes);

      state.savingAction = false;
      if (ok) closeModal("detailModal");
    }
  });

  $("referralList")?.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-booking-status]");
    if (!select) return;

    await updateReferralStatus(select.dataset.bookingStatus, select.value);
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});