import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  properties: "properties",
  residents: "residents",
  users: "users",
  bookings: "bookings",
  leads: "leads",
  invoices: "invoices",
  transactions: "transactions",
  complaints: "complaints",
  foodSubscriptions: "food_subscriptions",
  visitors: "visitors",
  parcels: "parcels",
  reports: "reports"
};

const COLORS = {
  navy: "#1f2a44",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  blue: "#2f80ed",
  orange: "#e18a00",
  purple: "#6352c7",
  grey: "#667085"
};

const CHART_COLORS = [
  COLORS.gold,
  COLORS.green,
  COLORS.navy,
  COLORS.red,
  COLORS.purple,
  COLORS.blue,
  COLORS.orange
];

const state = {
  properties: [],
  residents: [],
  users: [],
  bookings: [],
  leads: [],
  invoices: [],
  transactions: [],
  complaints: [],
  foodSubscriptions: [],
  visitors: [],
  parcels: [],
  reports: [],
  metrics: null
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

function numberValue(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  return Number(cleaned || 0);
}

function intValue(value) {
  if (typeof value === "number") return Math.round(value);
  const cleaned = String(value || "").replace(/[^0-9]/g, "");
  return Number.parseInt(cleaned || "0", 10);
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

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
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
  }, 2800);
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
      state[stateKey] = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
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
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("bookings", COLLECTIONS.bookings);
  listenCollection("leads", COLLECTIONS.leads);
  listenCollection("invoices", COLLECTIONS.invoices);
  listenCollection("transactions", COLLECTIONS.transactions);
  listenCollection("complaints", COLLECTIONS.complaints);
  listenCollection("foodSubscriptions", COLLECTIONS.foodSubscriptions);
  listenCollection("visitors", COLLECTIONS.visitors);
  listenCollection("parcels", COLLECTIONS.parcels);
  listenCollection("reports", COLLECTIONS.reports);
}

/* PROPERTY HELPERS */

function getPropertyName(property) {
  return firstNonEmpty([property.propertyName, property.name, property.title], property.id);
}

function getPropertyId(item) {
  return firstNonEmpty([
    item.propertyId,
    item.property_id,
    item.propertyDocId,
    item.propertyCode,
    item.propertyName,
    item.property
  ], "");
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
      map.set(String(key), {
        id: property.id,
        name
      });
    });
  });

  return map;
}

function getSelectedPropertyName() {
  return $("propertyFilter")?.value || "All Properties";
}

function selectedPropertyRecord() {
  const selected = getSelectedPropertyName();
  if (selected === "All Properties") return null;

  return state.properties.find((property) => getPropertyName(property) === selected) || null;
}

function itemMatchesSelectedProperty(item) {
  const selected = getSelectedPropertyName();
  if (selected === "All Properties") return true;

  const property = selectedPropertyRecord();
  const itemProperty = String(getPropertyId(item));

  return (
    itemProperty === selected ||
    itemProperty === String(property?.id || "") ||
    itemProperty === String(property?.propertyId || "") ||
    itemProperty === String(property?.propertyCode || "") ||
    itemProperty === String(property?.propertyName || "") ||
    itemProperty === String(property?.name || "")
  );
}

/* DATE RANGE */

function getDateField(item, keys = []) {
  const preferred = [
    ...keys,
    "createdAt",
    "updatedAt",
    "date",
    "invoiceDate",
    "paidAt",
    "transactionDate",
    "bookingDate",
    "visitDateTime",
    "visitDate",
    "receivedAt"
  ];

  for (const key of preferred) {
    if (item[key]) return item[key];
  }

  return "";
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isInRange(value) {
  const date = toDate(value);
  if (!date) return true;

  const range = $("rangeFilter")?.value || "This Month";
  const now = new Date();
  const today = startOfDay(now);
  const itemDay = startOfDay(date);

  if (range === "Today") {
    return itemDay.getTime() === today.getTime();
  }

  if (range === "Last 7 Days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return itemDay >= start && itemDay <= today;
  }

  if (range === "Last 30 Days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return itemDay >= start && itemDay <= today;
  }

  if (range === "This Year") {
    return date.getFullYear() === now.getFullYear();
  }

  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function isSameMonth(value) {
  const date = toDate(value);
  if (!date) return false;

  const now = new Date();

  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

/* AMOUNTS */

function invoiceTotal(invoice) {
  return firstPositive([
    numberValue(invoice.grandTotal),
    numberValue(invoice.totalAmount),
    numberValue(invoice.amount)
  ]);
}

function invoiceReceived(invoice) {
  return firstPositive([
    numberValue(invoice.amountReceived),
    numberValue(invoice.paidAmount),
    numberValue(invoice.receivedAmount)
  ]);
}

function transactionAmount(transaction) {
  return firstPositive([
    numberValue(transaction.amount),
    numberValue(transaction.paidAmount),
    numberValue(transaction.receivedAmount)
  ]);
}

function firstPositive(values) {
  for (const value of values) {
    if (Number(value) > 0) return Number(value);
  }

  return 0;
}

/* ANALYTICS DATA */

function activeResident(item) {
  const status = normalize(firstNonEmpty([
    item.status,
    item.residentStatus,
    item.accountStatus
  ], ""));

  return (
    status === "active" ||
    status === "moved in" ||
    status === "checked in" ||
    item.isActive === true
  );
}

function getPropertyAnalytics() {
  const propertyMap = getPropertyMap();

  const rows = state.properties.map((property) => {
    const propertyName = getPropertyName(property);

    let totalBeds = intValue(firstNonEmpty([
      property.totalBeds,
      property.beds,
      property.totalRooms,
      property.capacity
    ], 0));

    let occupiedBeds = intValue(firstNonEmpty([
      property.occupiedBeds,
      property.occupied,
      property.activeResidents
    ], 0));

    const countResident = (resident) => {
      if (!activeResident(resident)) return false;

      const itemProperty = getPropertyId(resident);

      return (
        itemProperty === property.id ||
        itemProperty === String(property.propertyId || "") ||
        itemProperty === String(property.propertyCode || "") ||
        itemProperty === propertyName
      );
    };

    occupiedBeds += state.residents.filter(countResident).length;

    occupiedBeds += state.users.filter((user) => {
      const role = normalize(firstNonEmpty([user.role, user.userRole, user.type], ""));
      const roleOk = !role || role === "resident" || role === "tenant" || role === "student";
      return roleOk && countResident(user);
    }).length;

    let revenue = 0;
    let collections = 0;

    state.invoices.forEach((invoice) => {
      if (!itemBelongsToProperty(invoice, property)) return;
      if (!isInRange(getDateField(invoice, ["createdAt", "invoiceDate"]))) return;

      revenue += invoiceTotal(invoice);
      collections += invoiceReceived(invoice);
    });

    state.transactions.forEach((transaction) => {
      if (!itemBelongsToProperty(transaction, property)) return;
      if (!isInRange(getDateField(transaction, ["paidAt", "createdAt", "transactionDate"]))) return;

      collections += transactionAmount(transaction);
    });

    const occupancyRate = totalBeds <= 0
      ? occupiedBeds > 0 ? 100 : 0
      : (occupiedBeds / totalBeds) * 100;

    return {
      id: property.id,
      name: propertyName,
      totalBeds,
      occupiedBeds,
      occupancyRate,
      revenue,
      collections,
      status: propertyStatus(occupancyRate)
    };
  });

  return rows
    .filter((row) => {
      if (getSelectedPropertyName() === "All Properties") return true;
      return row.name === getSelectedPropertyName();
    })
    .sort((a, b) => b.occupancyRate - a.occupancyRate);
}

function itemBelongsToProperty(item, property) {
  const itemProperty = getPropertyId(item);
  const propertyName = getPropertyName(property);

  return (
    itemProperty === property.id ||
    itemProperty === String(property.propertyId || "") ||
    itemProperty === String(property.propertyCode || "") ||
    itemProperty === propertyName
  );
}

function propertyStatus(rate) {
  if (rate >= 90) return "Excellent";
  if (rate >= 75) return "Good";
  if (rate >= 50) return "Average";
  return "Low";
}

function propertyStatusClass(status) {
  return normalize(status).replaceAll(" ", "-");
}

function propertyStatusColor(status) {
  const clean = normalize(status);

  if (clean === "excellent") return COLORS.green;
  if (clean === "good") return COLORS.blue;
  if (clean === "average") return COLORS.orange;
  if (clean === "low") return COLORS.red;

  return COLORS.navy;
}

function openComplaint(item) {
  const status = normalize(firstNonEmpty([
    item.status,
    item.complaintStatus
  ], "Open"));

  return status === "open" || status === "assigned" || status === "pending";
}

function bookingConfirmed(item) {
  const status = normalize(firstNonEmpty([
    item.status,
    item.bookingStatus
  ], ""));

  return status === "booked" || status === "booking confirmed" || status === "converted" || status === "confirmed";
}

function activeFoodSubscription(item) {
  const status = normalize(firstNonEmpty([
    item.status,
    item.subscriptionStatus
  ], ""));

  return status === "active" || status === "subscribed";
}

function foodAmount(item) {
  return firstPositive([
    numberValue(item.monthlyAmount),
    numberValue(item.totalAmount),
    numberValue(item.amount),
    numberValue(item.price)
  ]);
}

function reportType(item) {
  return firstNonEmpty([item.type, item.reportType], "Operational");
}

function reportStatus(item) {
  return firstNonEmpty([item.status], "Generated");
}

function reportName(item) {
  return firstNonEmpty([item.reportName, item.name, item.title], "Report");
}

function generatedBy(item) {
  return firstNonEmpty([item.generatedBy, item.createdBy], "Admin");
}

function computeMetrics() {
  const properties = getPropertyAnalytics();

  const filteredInvoices = state.invoices.filter((invoice) => {
    return itemMatchesSelectedProperty(invoice) && isInRange(getDateField(invoice, ["createdAt", "invoiceDate"]));
  });

  const filteredTransactions = state.transactions.filter((transaction) => {
    return itemMatchesSelectedProperty(transaction) && isInRange(getDateField(transaction, ["paidAt", "createdAt", "transactionDate"]));
  });

  const totalRevenue = filteredInvoices.reduce((sum, invoice) => {
    return sum + invoiceTotal(invoice);
  }, 0);

  const collectionsFromInvoices = filteredInvoices.reduce((sum, invoice) => {
    return sum + invoiceReceived(invoice);
  }, 0);

  const collectionsFromTransactions = filteredTransactions.reduce((sum, transaction) => {
    return sum + transactionAmount(transaction);
  }, 0);

  const collectionsThisMonth = collectionsFromInvoices + collectionsFromTransactions;

  const totalBeds = properties.reduce((sum, property) => sum + property.totalBeds, 0);
  const occupiedBeds = properties.reduce((sum, property) => sum + property.occupiedBeds, 0);
  const occupancyRate = totalBeds <= 0 ? occupiedBeds > 0 ? 100 : 0 : (occupiedBeds / totalBeds) * 100;

  const complaints = state.complaints.filter((complaint) => {
    return itemMatchesSelectedProperty(complaint) && openComplaint(complaint);
  });

  const complaintCategories = {};

  complaints.forEach((complaint) => {
    const category = firstNonEmpty([
      complaint.category,
      complaint.complaintCategory,
      complaint.type
    ], "Others");

    complaintCategories[category] = (complaintCategories[category] || 0) + 1;
  });

  const bookings = state.bookings.filter((booking) => {
    return itemMatchesSelectedProperty(booking) && isInRange(getDateField(booking, ["createdAt", "bookingDate"]));
  });

  const convertedLeads = state.leads.filter((lead) => {
    return itemMatchesSelectedProperty(lead) &&
      bookingConfirmed(lead) &&
      isInRange(getDateField(lead, ["createdAt", "bookingDate"]));
  });

  const foodSubscriptions = state.foodSubscriptions.filter((item) => {
    return itemMatchesSelectedProperty(item) || getSelectedPropertyName() === "All Properties";
  });

  const activeFood = foodSubscriptions.filter(activeFoodSubscription);

  const visitors = state.visitors.filter((visitor) => {
    return itemMatchesSelectedProperty(visitor) && isInRange(getDateField(visitor, ["visitDateTime", "createdAt"]));
  });

  const parcels = state.parcels.filter((parcel) => {
    return itemMatchesSelectedProperty(parcel) && isInRange(getDateField(parcel, ["receivedAt", "createdAt"]));
  });

  const revenueTrend = buildTrendSeries(filteredInvoices, ["createdAt", "invoiceDate"], invoiceTotal);
  const collectionsTrend = buildCollectionsTrend(filteredInvoices, filteredTransactions);

  return {
    properties,
    totalRevenue,
    collectionsThisMonth,
    occupancyRate,
    totalBeds,
    occupiedBeds,
    openComplaints: complaints.length,
    newBookings: bookings.length + convertedLeads.length,
    totalFoodSubscribers: foodSubscriptions.length,
    activeFoodSubscribers: activeFood.length,
    foodRevenue: foodSubscriptions.reduce((sum, item) => sum + foodAmount(item), 0),
    visitorsThisMonth: visitors.length,
    parcelsReceived: parcels.length,
    complaintCategories,
    revenueTrend,
    collectionsTrend
  };
}

function buildTrendSeries(items, dateKeys, amountGetter) {
  const series = Array(7).fill(0);
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setDate(start.getDate() - 6);

  items.forEach((item) => {
    const date = toDate(getDateField(item, dateKeys));
    if (!date) return;

    const cleanDate = startOfDay(date);
    const index = Math.round((cleanDate - start) / (1000 * 60 * 60 * 24));

    if (index >= 0 && index <= 6) {
      series[index] += amountGetter(item);
    }
  });

  return series;
}

function buildCollectionsTrend(invoices, transactions) {
  const series = Array(7).fill(0);
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setDate(start.getDate() - 6);

  function addValue(item, dateKeys, amountGetter) {
    const date = toDate(getDateField(item, dateKeys));
    if (!date) return;

    const cleanDate = startOfDay(date);
    const index = Math.round((cleanDate - start) / (1000 * 60 * 60 * 24));

    if (index >= 0 && index <= 6) {
      series[index] += amountGetter(item);
    }
  }

  invoices.forEach((invoice) => addValue(invoice, ["createdAt", "invoiceDate"], invoiceReceived));
  transactions.forEach((transaction) => addValue(transaction, ["paidAt", "createdAt", "transactionDate"], transactionAmount));

  return series;
}

/* RENDER */

function renderPage() {
  renderFilters();

  state.metrics = computeMetrics();

  renderStats();
  renderCharts();
  renderFoodAndActivity();
  renderTopProperties();
  renderRecentReports();
  renderInsights();
}

function renderFilters() {
  const propertySelect = $("propertyFilter");
  if (propertySelect) {
    const previous = propertySelect.value || "All Properties";
    const names = [
      "All Properties",
      ...new Set(state.properties.map(getPropertyName).filter(Boolean))
    ];

    propertySelect.innerHTML = names.map((name) => {
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    }).join("");

    propertySelect.value = names.includes(previous) ? previous : "All Properties";
  }

  const typeSelect = $("reportTypeFilter");
  if (typeSelect) {
    const previous = typeSelect.value || "All Report Types";

    const types = [
      "All Report Types",
      "Financial",
      "Occupancy",
      "Collections",
      "Complaints",
      "Operational",
      "Analytics",
      "PDF Export",
      ...new Set(state.reports.map(reportType).filter(Boolean))
    ];

    const unique = [...new Set(types)];

    typeSelect.innerHTML = unique.map((type) => {
      return `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`;
    }).join("");

    typeSelect.value = unique.includes(previous) ? previous : "All Report Types";
  }
}

function renderStats() {
  const data = state.metrics || computeMetrics();

  setText("totalRevenueValue", formatMoney(data.totalRevenue));
  setText("occupancyRateValue", `${Math.round(data.occupancyRate)}%`);
  setText("collectionsValue", formatMoney(data.collectionsThisMonth));
  setText("openComplaintsValue", data.openComplaints);
  setText("newBookingsValue", data.newBookings);

  setText("revenueTrendText", "All time invoices");
  setText("occupancyTrendText", `${data.occupiedBeds}/${data.totalBeds} beds occupied`);
  setText("collectionsTrendText", "Received payments");
  setText("complaintsTrendText", "Need attention");
  setText("bookingsTrendText", "This month");

  renderSparkline("revenueSpark", data.revenueTrend, COLORS.gold);
  renderSparkline("collectionsSpark", data.collectionsTrend, COLORS.green);
  renderSparkline("occupancySpark", occupancyMiniTrend(data.occupancyRate), COLORS.navy);
  renderSparkline("complaintsSpark", miniTrend(data.openComplaints), COLORS.red);
  renderSparkline("bookingsSpark", miniTrend(data.newBookings), COLORS.purple);
}

function occupancyMiniTrend(value) {
  const base = Number(value || 0);

  return [
    base * 0.82,
    base * 0.88,
    base * 0.86,
    base * 0.94,
    base * 0.91,
    base * 0.98,
    base
  ];
}

function miniTrend(value) {
  const base = value <= 0 ? 1 : value;

  return [
    base * 0.4,
    base * 0.7,
    base * 0.6,
    base * 0.8,
    base * 0.9,
    base * 1.1,
    base
  ];
}

function renderCharts() {
  const data = state.metrics || computeMetrics();

  renderLineChart("revenueCollectionChart", data.revenueTrend, data.collectionsTrend);
  renderPropertyOccupancyChart(data.properties.slice(0, 6));
  renderComplaintDonut(data.complaintCategories);

  const inactiveFood = Math.max(data.totalFoodSubscribers - data.activeFoodSubscribers, 0);

  renderMiniBarChart("foodSubscriptionChart", {
    Active: data.activeFoodSubscribers,
    Inactive: inactiveFood
  });

  renderMiniBarChart("activityChart", {
    Visitors: data.visitorsThisMonth,
    Parcels: data.parcelsReceived
  });

  const reportTypes = {};
  state.reports.forEach((report) => {
    const type = reportType(report);
    reportTypes[type] = (reportTypes[type] || 0) + 1;
  });

  renderMiniBarChart("reportTypeChart", reportTypes);

  const propertyCollections = {};
  data.properties.forEach((property) => {
    if (property.collections > 0) {
      propertyCollections[property.name] = property.collections;
    }
  });

  renderMiniBarChart("propertyCollectionChart", propertyCollections, formatMoney);
}

function renderSparkline(id, values, color) {
  const container = $(id);
  if (!container) return;

  const points = normalizedPoints(values, 260, 38, 3);

  if (!points.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <svg viewBox="0 0 260 38" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="${color}"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        points="${points.map((p) => `${p.x},${p.y}`).join(" ")}"
      ></polyline>
    </svg>
  `;
}

function normalizedPoints(values, width, height, pad = 0) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value));

  if (!nums.length) return [];

  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min || 1;

  return nums.map((value, index) => {
    const x = nums.length === 1
      ? pad
      : pad + (index / (nums.length - 1)) * (width - pad * 2);

    const y = height - pad - ((value - min) / range) * (height - pad * 2);

    return { x, y };
  });
}

function renderLineChart(id, revenue, collections) {
  const container = $(id);
  if (!container) return;

  const width = 760;
  const height = 260;
  const pad = 34;

  const revenuePoints = normalizedPointsWithMax(revenue, width, height, pad, [...revenue, ...collections]);
  const collectionPoints = normalizedPointsWithMax(collections, width, height, pad, [...revenue, ...collections]);

  const labels = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${[0, 1, 2, 3, 4].map((line) => {
        const y = pad + line * ((height - pad * 2) / 4);
        return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="rgba(31,42,68,.12)" stroke-width="1"></line>`;
      }).join("")}

      <polyline fill="none" stroke="${COLORS.gold}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${revenuePoints.map((p) => `${p.x},${p.y}`).join(" ")}"></polyline>
      <polyline fill="none" stroke="${COLORS.green}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${collectionPoints.map((p) => `${p.x},${p.y}`).join(" ")}"></polyline>

      ${revenuePoints.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${COLORS.gold}"></circle>`).join("")}
      ${collectionPoints.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${COLORS.green}"></circle>`).join("")}

      ${labels.map((label, index) => {
        const x = pad + (index / 6) * (width - pad * 2);
        return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#667085" font-size="11" font-weight="700">${label}</text>`;
      }).join("")}

      <circle cx="${pad}" cy="13" r="5" fill="${COLORS.gold}"></circle>
      <text x="${pad + 12}" y="17" fill="${COLORS.navy}" font-size="12" font-weight="800">Revenue</text>

      <circle cx="${pad + 105}" cy="13" r="5" fill="${COLORS.green}"></circle>
      <text x="${pad + 117}" y="17" fill="${COLORS.navy}" font-size="12" font-weight="800">Collections</text>
    </svg>
  `;
}

function normalizedPointsWithMax(values, width, height, pad, combined) {
  const nums = values.map(Number);
  const all = combined.map(Number).filter((value) => Number.isFinite(value));
  const max = Math.max(...all, 1);

  return nums.map((value, index) => {
    const x = nums.length === 1
      ? pad
      : pad + (index / (nums.length - 1)) * (width - pad * 2);

    const y = height - pad - (value / max) * (height - pad * 2);

    return { x, y };
  });
}

function renderPropertyOccupancyChart(properties) {
  const container = $("propertyOccupancyChart");
  if (!container) return;

  if (!properties.length) {
    container.innerHTML = `<div class="empty-state">No property data found.</div>`;
    return;
  }

  container.innerHTML = properties.map((property) => {
    const width = Math.max(4, Math.min(100, Math.round(property.occupancyRate)));

    return `
      <div class="chart-row">
        <span>${escapeHtml(property.name)}</span>
        <div class="chart-track">
          <div class="chart-fill" style="width:${width}%;background:${propertyStatusColor(property.status)};"></div>
        </div>
        <strong>${Math.round(property.occupancyRate)}%</strong>
      </div>
    `;
  }).join("");
}

function renderComplaintDonut(categories) {
  const entries = Object.entries(categories)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const donut = $("complaintDonut");
  const legend = $("complaintLegend");

  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);

  setText("complaintChartSubtitle", `${total} open complaints.`);
  setText("complaintDonutTotal", total);

  if (!donut || !legend) return;

  if (!entries.length) {
    donut.style.background = `conic-gradient(rgba(182,139,45,.14) 0deg 360deg)`;
    legend.innerHTML = `<div class="empty-state">No complaint category data.</div>`;
    return;
  }

  let current = 0;

  const stops = entries.map(([, value], index) => {
    const start = current;
    const end = current + (Number(value) / total) * 360;
    current = end;

    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}deg ${end}deg`;
  });

  donut.style.background = `conic-gradient(${stops.join(", ")})`;

  legend.innerHTML = entries.slice(0, 5).map(([label, value], index) => {
    const percent = total ? Math.round((Number(value) / total) * 100) : 0;

    return `
      <div class="legend-row">
        <div class="legend-left">
          <span class="legend-dot" style="background:${CHART_COLORS[index % CHART_COLORS.length]};"></span>
          <span>${escapeHtml(label)}</span>
        </div>
        <strong>${value} (${percent}%)</strong>
      </div>
    `;
  }).join("");
}

function renderMiniBarChart(id, dataMap, formatter = (value) => value.toString()) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(dataMap)
    .filter(([key]) => String(key).trim())
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const max = Math.max(...entries.map(([, value]) => Number(value)), 0);

  if (!entries.length || max <= 0) {
    container.innerHTML = `<div class="empty-state">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.slice(0, 7).map(([label, value], index) => {
    const numeric = Number(value);
    const width = Math.max(5, Math.round((numeric / max) * 100));
    const color = CHART_COLORS[index % CHART_COLORS.length];

    return `
      <div class="chart-row">
        <span>${escapeHtml(label)}</span>
        <div class="chart-track">
          <div class="chart-fill" style="width:${width}%;background:${color};"></div>
        </div>
        <strong>${escapeHtml(formatter(numeric))}</strong>
      </div>
    `;
  }).join("");
}

/* PANELS */

function renderFoodAndActivity() {
  const data = state.metrics || computeMetrics();

  const activeRate = data.totalFoodSubscribers
    ? Math.round((data.activeFoodSubscribers / data.totalFoodSubscribers) * 100)
    : 0;

  setText("foodTotalSubscribers", data.totalFoodSubscribers);
  setText("foodActiveSubscribers", data.activeFoodSubscribers);
  setText("foodRevenue", formatMoney(data.foodRevenue));
  setText("foodActiveRate", `${activeRate}%`);
  setText("visitorsThisMonth", data.visitorsThisMonth);
  setText("parcelsReceived", data.parcelsReceived);
}

function renderTopProperties() {
  const body = $("topPropertiesBody");
  if (!body) return;

  const data = state.metrics || computeMetrics();
  const rows = data.properties.slice(0, 8);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty-row">No property performance found.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((row) => {
    return `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${Math.round(row.occupancyRate)}%</td>
        <td>${escapeHtml(formatMoney(row.revenue))}</td>
        <td>${escapeHtml(formatMoney(row.collections))}</td>
        <td>
          <span class="status-pill ${propertyStatusClass(row.status)}">
            ${escapeHtml(row.status)}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

function filteredReports() {
  const search = normalize($("reportSearchInput")?.value || $("globalSearchInput")?.value);
  const typeFilter = $("reportTypeFilter")?.value || "All Report Types";

  return [...state.reports]
    .filter((report) => {
      const matchesSearch = !search || [
        reportName(report),
        reportType(report),
        generatedBy(report),
        reportStatus(report)
      ].join(" ").toLowerCase().includes(search);

      const matchesType = typeFilter === "All Report Types" || reportType(report) === typeFilter;

      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      const dateA = toDate(a.generatedAt || a.createdAt)?.getTime() || 0;
      const dateB = toDate(b.generatedAt || b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });
}

function renderRecentReports() {
  const body = $("recentReportsBody");
  if (!body) return;

  const reports = filteredReports();

  if (!reports.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty-row">No reports generated yet.</td></tr>`;
    return;
  }

  body.innerHTML = reports.slice(0, 8).map((report) => {
    const status = reportStatus(report);

    return `
      <tr>
        <td>${escapeHtml(reportName(report))}</td>
        <td>${escapeHtml(formatDateTime(report.generatedAt || report.createdAt))}</td>
        <td>${escapeHtml(reportType(report))}</td>
        <td>
          <span class="status-pill generated">${escapeHtml(status)}</span>
        </td>
      </tr>
    `;
  }).join("");
}

function renderInsights() {
  const container = $("quickInsightsList");
  if (!container) return;

  const data = state.metrics || computeMetrics();
  const topProperty = data.properties[0] || null;
  const lowProperty = [...data.properties].sort((a, b) => a.occupancyRate - b.occupancyRate)[0] || null;

  const categoryEntries = Object.entries(data.complaintCategories)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const topComplaint = categoryEntries[0];

  const insights = [
    {
      type: "success",
      icon: "fa-solid fa-house",
      text: topProperty
        ? `${topProperty.name} has the highest occupancy at ${Math.round(topProperty.occupancyRate)}%.`
        : "No property occupancy data available yet."
    },
    {
      type: "danger",
      icon: "fa-solid fa-circle-exclamation",
      text: lowProperty
        ? `${lowProperty.name} needs attention with ${Math.round(lowProperty.occupancyRate)}% occupancy.`
        : "No low occupancy property detected."
    },
    {
      type: "warning",
      icon: "fa-solid fa-triangle-exclamation",
      text: topComplaint
        ? `${topComplaint[0]} is the top complaint category with ${topComplaint[1]} case(s).`
        : "No complaint categories found yet."
    },
    {
      type: "success",
      icon: "fa-solid fa-chart-line",
      text: `Revenue and collection trend is generated from invoices and transactions.`
    },
    {
      type: "info",
      icon: "fa-regular fa-calendar-check",
      text: `New bookings in selected range: ${data.newBookings}.`
    }
  ];

  container.innerHTML = insights.map((item) => {
    return `
      <div class="insight-row ${item.type}">
        <i class="${item.icon}"></i>
        <p>${escapeHtml(item.text)}</p>
      </div>
    `;
  }).join("");
}

/* REPORT GENERATION */

async function generateReport(type) {
  try {
    const data = state.metrics || computeMetrics();
    const ref = doc(collection(db, COLLECTIONS.reports));

    await setDoc(ref, {
      reportId: ref.id,
      reportName: `${type} Report`,
      type,
      propertyFilter: $("propertyFilter")?.value || "All Properties",
      rangeFilter: $("rangeFilter")?.value || "This Month",
      totalRevenue: data.totalRevenue,
      collectionsThisMonth: data.collectionsThisMonth,
      occupancyRate: data.occupancyRate,
      openComplaints: data.openComplaints,
      newBookings: data.newBookings,
      generatedBy: "admin",
      status: "Generated",
      source: "admin_website",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast(`${type} report generated successfully.`);
  } catch (error) {
    console.error("Generate report failed:", error);
    showToast(`Failed to generate report: ${error.message}`, "error");
  }
}

async function exportReportCsv() {
  await generateReport("Analytics");

  const data = state.metrics || computeMetrics();

  const headers = [
    "Property",
    "Occupancy",
    "Total Beds",
    "Occupied Beds",
    "Revenue",
    "Collections",
    "Status"
  ];

  const rows = data.properties.map((property) => [
    property.name,
    `${Math.round(property.occupancyRate)}%`,
    property.totalBeds,
    property.occupiedBeds,
    property.revenue,
    property.collections,
    property.status
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `reports-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

async function downloadPdf() {
  await generateReport("PDF Export");
  window.print();
}

/* EVENTS */

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Reports refreshed.");
  });

  [
    "globalSearchInput",
    "reportSearchInput",
    "propertyFilter",
    "rangeFilter",
    "reportTypeFilter"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", renderPage);
    el.addEventListener("change", renderPage);
  });

  $("resetFiltersBtn")?.addEventListener("click", () => {
    if ($("globalSearchInput")) $("globalSearchInput").value = "";
    if ($("reportSearchInput")) $("reportSearchInput").value = "";
    if ($("propertyFilter")) $("propertyFilter").value = "All Properties";
    if ($("rangeFilter")) $("rangeFilter").value = "This Month";
    if ($("reportTypeFilter")) $("reportTypeFilter").value = "All Report Types";

    renderPage();
  });

  $("exportReportBtn")?.addEventListener("click", exportReportCsv);
  $("downloadPdfBtn")?.addEventListener("click", downloadPdf);

  $("generateOperationalReportBtn")?.addEventListener("click", () => {
    generateReport("Operational");
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});