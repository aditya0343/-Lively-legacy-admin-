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
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

console.log("admin.js loaded");

const COLLECTIONS = {
  properties: "properties",
  rooms: "rooms",
  beds: "beds",
  bookings: "bookings",
  users: "users",
  staff: "staff",
  residents: "residents",
  complaints: "complaints",
  tasks: "tasks",
  invoices: "invoices",
  transactions: "transactions",
  activityLogs: "activity_logs",
  notifications: "notifications"
};

const colors = {
  navy: "#061B32",
  gold: "#B68B2D",
  green: "#109A43",
  red: "#E50922",
  purple: "#6352C7",
  orange: "#FF7A00",
  blue: "#0D6EFF"
};

const $ = (id) => document.getElementById(id);

const chartInstances = {};

const state = {
  user: null,
  profile: null,
  docs: {},
  subscriptions: [],
  debounce: null,
  readKeys: new Set(JSON.parse(localStorage.getItem("ll_admin_read_notifications") || "[]")),
  currentUnreadActivities: []
};

function createOrUpdateChart(id, config) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return;

  if (chartInstances[id]) {
    chartInstances[id].data = config.data;
    chartInstances[id].options = config.options || {};
    chartInstances[id].update();
    return;
  }

  chartInstances[id] = new Chart(canvas, config);
}

function resizeCharts() {
  Object.values(chartInstances).forEach((chart) => {
    if (chart && typeof chart.resize === "function") chart.resize();
  });
}

function toast(message, isError = false) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function text(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (value !== undefined && value !== null) {
      const clean = String(value).trim();
      if (clean) return clean;
    }
  }

  return "";
}

function lower(data, keys) {
  return text(data, keys).toLowerCase().trim();
}

function number(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

function dateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function date(data, keys) {
  for (const key of keys) {
    const parsed = dateValue(data?.[key]);
    if (parsed) return parsed;
  }

  return null;
}

function isSameDay(a, b) {
  if (!a || !b) return false;

  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isActiveBooking(status) {
  return [
    "confirmed",
    "booked",
    "active",
    "checked_in",
    "checked-in",
    "checked in",
    "ongoing"
  ].includes(status);
}

function isCancelled(status) {
  return ["cancelled", "canceled", "refunded", "rejected"].includes(status);
}

function isResolved(status) {
  return ["resolved", "closed", "completed", "done"].includes(status);
}

function isRevenuePaidStatus(status) {
  return ["paid", "completed", "success", "successful", "received", "settled"].includes(status);
}

function isPendingPaymentStatus(status) {
  return ["pending", "unpaid", "partial", "partially paid", "due", "overdue"].includes(status);
}

function money(value) {
  const clean = Number(value || 0);

  if (clean >= 1000000) return `₹${(clean / 1000000).toFixed(1)}M`;
  if (clean >= 1000) return `₹${(clean / 1000).toFixed(1)}K`;

  return `₹${Math.round(clean)}`;
}

function cleanLabel(value, fallback = "Unknown") {
  const raw = String(value || "").trim();

  if (!raw) return fallback;

  return raw
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function lastSixMonths(now = new Date()) {
  return Array.from({ length: 6 }, (_, index) => {
    const monthsBack = 5 - index;
    return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  });
}

function monthLabel(dateObj) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dateObj.getMonth()];
}

function monthlyCounts(docs, dateKeys) {
  const now = new Date();
  const months = lastSixMonths(now);
  const values = Array(6).fill(0);

  docs.forEach((item) => {
    const d = date(item.data, dateKeys);
    if (!d) return;

    const monthsAgo =
      (now.getFullYear() - d.getFullYear()) * 12 +
      now.getMonth() -
      d.getMonth();

    if (monthsAgo >= 0 && monthsAgo < 6) {
      values[5 - monthsAgo] += 1;
    }
  });

  return months.map((m, index) => ({
    label: monthLabel(m),
    value: values[index]
  }));
}

function monthlyRevenue(docs, dateKeys, amountKeys) {
  const now = new Date();
  const months = lastSixMonths(now);
  const values = Array(6).fill(0);

  docs.forEach((item) => {
    const d = date(item.data, dateKeys);
    if (!d) return;

    const status = lower(item.data, [
      "status",
      "paymentStatus",
      "transactionStatus",
      "invoiceStatus",
      "bookingStatus"
    ]);

    if (isCancelled(status)) return;

    const monthsAgo =
      (now.getFullYear() - d.getFullYear()) * 12 +
      now.getMonth() -
      d.getMonth();

    if (monthsAgo >= 0 && monthsAgo < 6) {
      values[5 - monthsAgo] += number(item.data, amountKeys);
    }
  });

  return months.map((m, index) => ({
    label: monthLabel(m),
    value: values[index]
  }));
}

function trendHasData(points) {
  return points.some((point) => point.value > 0);
}

function complaintTrend(value) {
  const base = value <= 0 ? 1 : value;
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const multipliers = [0.4, 0.8, 0.5, 1, 0.7, 0.9];

  return labels.map((label, index) => ({
    label,
    value: base * multipliers[index]
  }));
}

function activityItems({ activityLogs, notifications }) {
  const items = [];

  function addDocs(docs, collectionName) {
    docs.forEach((item) => {
      const data = item.data;

      const title = text(data, [
        "title",
        "activityTitle",
        "action",
        "event",
        "type"
      ]);

      const message = text(data, [
        "message",
        "description",
        "activityMessage",
        "details",
        "body"
      ]);

      const type =
        text(data, ["type", "activityType", "module", "category"]) ||
        "activity";

      const createdAt =
        date(data, ["createdAt", "created_at", "timestamp", "time", "date"]) ||
        new Date();

      const readKey = `${collectionName}_${item.id}`;
      const isRead =
        data.isRead === true ||
        data.adminRead === true ||
        state.readKeys.has(readKey);

      items.push({
        id: item.id,
        collection: collectionName,
        readKey,
        title: title ? cleanLabel(title, "New activity") : "New activity",
        message: message || "A new update was recorded in the system.",
        type,
        createdAt,
        isRead
      });
    });
  }

  addDocs(activityLogs, COLLECTIONS.activityLogs);
  addDocs(notifications, COLLECTIONS.notifications);

  return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

function buildDashboardData() {
  const properties = state.docs[COLLECTIONS.properties] || [];
  const rooms = state.docs[COLLECTIONS.rooms] || [];
  const beds = state.docs[COLLECTIONS.beds] || [];
  const bookings = state.docs[COLLECTIONS.bookings] || [];
  const users = state.docs[COLLECTIONS.users] || [];
  const staff = state.docs[COLLECTIONS.staff] || [];
  const residents = state.docs[COLLECTIONS.residents] || [];
  const complaints = state.docs[COLLECTIONS.complaints] || [];
  const tasks = state.docs[COLLECTIONS.tasks] || [];
  const invoices = state.docs[COLLECTIONS.invoices] || [];
  const transactions = state.docs[COLLECTIONS.transactions] || [];
  const activityLogs = state.docs[COLLECTIONS.activityLogs] || [];
  const notifications = state.docs[COLLECTIONS.notifications] || [];

  const latestActivities = activityItems({ activityLogs, notifications });
  const notificationCount = latestActivities.filter((item) => !item.isRead).length;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalProperties = properties.length;
  const totalRooms = rooms.length;
  const totalBeds = beds.length;

  const activeBookings = bookings.filter((item) =>
    isActiveBooking(lower(item.data, ["status", "bookingStatus"]))
  );

  const occupiedPropertyIds = new Set();
  const occupiedBedIds = new Set();

  activeBookings.forEach((item) => {
    const propertyId = text(item.data, [
      "propertyId",
      "property_id",
      "listingId",
      "listing_id"
    ]);

    const bedId = text(item.data, ["bedId", "bed_id"]);

    if (propertyId) occupiedPropertyIds.add(propertyId);
    if (bedId) occupiedBedIds.add(bedId);
  });

  beds.forEach((item) => {
    const status = lower(item.data, ["status", "bedStatus"]);

    if (item.data.isOccupied === true || status === "occupied") {
      occupiedBedIds.add(item.id);
    }
  });

  const occupiedProperties = occupiedPropertyIds.size;

  const occupancyRate =
    totalBeds > 0
      ? Math.min(100, Math.max(0, (occupiedBedIds.size / totalBeds) * 100))
      : totalProperties === 0
        ? 0
        : Math.min(100, Math.max(0, (occupiedProperties / totalProperties) * 100));

  const totalBookings = bookings.length;

  const newBookings = bookings.filter((item) => {
    const d = date(item.data, ["createdAt", "created_at", "bookingDate"]);
    return d && d >= startOfMonth;
  }).length;

  const transactionsRevenue = transactions.reduce((sum, item) => {
    if (!isRevenuePaidStatus(lower(item.data, ["status", "paymentStatus", "transactionStatus"]))) {
      return sum;
    }

    return sum + number(item.data, [
      "amount",
      "paidAmount",
      "amountPaid",
      "totalAmount",
      "receivedAmount",
      "amountReceived",
      "value"
    ]);
  }, 0);

  const invoicesRevenue = invoices.reduce((sum, item) => {
    if (!isRevenuePaidStatus(lower(item.data, ["status", "paymentStatus", "invoiceStatus"]))) {
      return sum;
    }

    return sum + number(item.data, [
      "amount",
      "paidAmount",
      "amountPaid",
      "totalAmount",
      "receivedAmount",
      "amountReceived",
      "invoiceAmount"
    ]);
  }, 0);

  const bookingsRevenue = bookings.reduce((sum, item) => {
    if (isCancelled(lower(item.data, ["status", "bookingStatus"]))) {
      return sum;
    }

    return sum + number(item.data, [
      "amount",
      "totalAmount",
      "total_amount",
      "price",
      "bookingAmount",
      "paidAmount",
      "amountReceived"
    ]);
  }, 0);

  const totalRevenue =
    transactionsRevenue > 0
      ? transactionsRevenue
      : invoicesRevenue > 0
        ? invoicesRevenue
        : bookingsRevenue;

  const staffUserIds = new Set();

  users.forEach((item) => {
    if (lower(item.data, ["role", "userRole"]) === "staff") {
      staffUserIds.add(item.id);
    }
  });

  staff.forEach((item) => {
    staffUserIds.add(item.id);
  });

  const staffCount = staffUserIds.size;

  const openComplaints = complaints.filter((item) =>
    !isResolved(lower(item.data, ["status", "complaintStatus"]))
  ).length;

  const resolvedComplaints = complaints.filter((item) =>
    isResolved(lower(item.data, ["status", "complaintStatus"]))
  ).length;

  const pendingTasks = tasks.filter((item) => {
    const status = lower(item.data, ["status", "taskStatus"]);
    return ["pending", "open", "assigned", "in_progress"].includes(status);
  }).length;

  const pendingPayments =
    bookings.filter((item) =>
      isPendingPaymentStatus(lower(item.data, ["paymentStatus", "payment_status"]))
    ).length +
    invoices.filter((item) =>
      isPendingPaymentStatus(lower(item.data, ["status", "paymentStatus", "invoiceStatus"]))
    ).length;

  const pendingKyc =
    users.filter((item) =>
      ["pending", "in_review", "unverified"].includes(
        lower(item.data, ["kycStatus", "kyc_status", "verificationStatus"])
      )
    ).length +
    residents.filter((item) =>
      ["pending", "in_review", "unverified"].includes(
        lower(item.data, ["kycStatus", "kyc_status", "verificationStatus"])
      )
    ).length;

  const checkInsToday = bookings.filter((item) =>
    isSameDay(
      date(item.data, ["checkIn", "check_in", "checkInDate", "checkedInAt"]),
      now
    )
  ).length;

  const checkOutsToday = bookings.filter((item) =>
    isSameDay(
      date(item.data, ["checkOut", "check_out", "checkOutDate", "checkedOutAt"]),
      now
    )
  ).length;

  const penalty =
    openComplaints * 3 +
    pendingTasks * 2 +
    pendingPayments +
    pendingKyc;

  const operationalScore = Math.min(100, Math.max(0, 100 - penalty));

  const bookingTrend = monthlyCounts(bookings, [
    "createdAt",
    "created_at",
    "bookingDate",
    "checkIn",
    "check_in"
  ]);

  const transactionRevenueTrend = monthlyRevenue(
    transactions,
    ["createdAt", "created_at", "paidAt", "paymentDate", "transactionDate"],
    ["amount", "paidAmount", "amountPaid", "totalAmount", "receivedAmount", "amountReceived", "value"]
  );

  const invoiceRevenueTrend = monthlyRevenue(
    invoices,
    ["createdAt", "created_at", "paidAt", "paymentDate", "invoiceDate"],
    ["amount", "paidAmount", "amountPaid", "totalAmount", "invoiceAmount", "receivedAmount", "amountReceived"]
  );

  const bookingRevenueTrend = monthlyRevenue(
    bookings,
    ["createdAt", "created_at", "bookingDate", "checkIn", "check_in"],
    ["amount", "totalAmount", "total_amount", "price", "bookingAmount", "paidAmount", "amountReceived"]
  );

  const revenueTrend = trendHasData(transactionRevenueTrend)
    ? transactionRevenueTrend
    : trendHasData(invoiceRevenueTrend)
      ? invoiceRevenueTrend
      : bookingRevenueTrend;

  const propertyOccupancy = properties.map((propertyDoc) => {
    const p = propertyDoc.data;
    const propertyName =
      text(p, ["propertyName", "name", "title"]) || propertyDoc.id;

    const propertyBeds = beds.filter((bed) => {
      const bedPropertyId = text(bed.data, ["propertyId", "property_id"]);
      const bedPropertyName = text(bed.data, ["propertyName", "property"]);

      return bedPropertyId === propertyDoc.id || bedPropertyName === propertyName;
    });

    const occupied = propertyBeds.filter((bed) => {
      const status = lower(bed.data, ["status", "bedStatus"]);

      return (
        bed.data.isOccupied === true ||
        status === "occupied" ||
        occupiedBedIds.has(bed.id)
      );
    }).length;

    const total =
      propertyBeds.length ||
      number(p, ["totalBeds", "bedsCount", "bedCount"]);

    const percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;

    return {
      id: propertyDoc.id,
      name: propertyName,
      address: text(p, ["address", "propertyAddress", "fullAddress", "location", "city"]),
      occupied,
      total,
      percentage: Math.min(100, Math.max(0, percentage))
    };
  }).sort((a, b) => b.percentage - a.percentage);

  return {
    totalProperties,
    totalRooms,
    totalBeds,
    occupiedProperties,
    totalBookings,
    newBookings,
    staffCount,
    openComplaints,
    resolvedComplaints,
    pendingTasks,
    pendingPayments,
    pendingKyc,
    checkInsToday,
    checkOutsToday,
    totalRevenue,
    occupancyRate,
    operationalScore,
    bookingTrend,
    revenueTrend,
    propertyOccupancy,
    notificationCount,
    latestActivities
  };
}

function chartData(points) {
  return {
    labels: points.map((p) => p.label),
    values: points.map((p) => p.value)
  };
}

function renderLineChart(id, points, color, moneyAxis = false) {
  const data = chartData(points);

  createOrUpdateChart(id, {
    type: "line",
    data: {
      labels: data.labels,
      datasets: [{
        data: data.values,
        borderColor: color,
        backgroundColor: `${color}22`,
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: color
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => moneyAxis ? money(ctx.raw) : String(ctx.raw)
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "rgba(6,27,50,0.48)" }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(6,27,50,0.06)" },
          ticks: {
            color: "rgba(6,27,50,0.48)",
            callback: (value) => moneyAxis ? money(value) : value
          }
        }
      }
    }
  });
}

function renderSpark(id, points, color) {
  const data = chartData(points);

  createOrUpdateChart(id, {
    type: "line",
    data: {
      labels: data.labels,
      datasets: [{
        data: data.values,
        borderColor: color,
        backgroundColor: `${color}18`,
        fill: true,
        tension: 0.45,
        borderWidth: 2,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true }
      }
    }
  });
}

function renderDoughnut(id, segments) {
  createOrUpdateChart(id, {
    type: "doughnut",
    data: {
      labels: segments.map((item) => item.label),
      datasets: [{
        data: segments.map((item) => item.value),
        backgroundColor: segments.map((item) => item.color),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "60%",
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInfoList(id, items) {
  const el = $(id);
  if (!el) return;

  el.innerHTML = items.map((item) => `
    <div class="info-row">
      <i class="${item.icon}" style="color:${item.color}"></i>
      <span>${escapeHtml(item.title)}</span>
      <b style="color:${item.color}">${escapeHtml(String(item.value))}</b>
    </div>
  `).join("");
}

function renderPropertyList(data) {
  const el = $("propertyList");
  if (!el) return;

  if (!data.propertyOccupancy.length) {
    el.innerHTML = `<p class="empty-state">No property data found yet.</p>`;
    return;
  }

  el.innerHTML = data.propertyOccupancy.slice(0, 6).map((item) => `
    <div class="property-row">
      <div class="property-thumb">
        <i class="fa-solid fa-building"></i>
      </div>

      <div class="property-details">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.address || `${item.occupied}/${item.total || 0} beds occupied`)}</span>
        <div class="occupancy-bar">
          <div style="width:${item.percentage}%"></div>
        </div>
      </div>

      <b>${item.percentage}%</b>
    </div>
  `).join("");
}

function activityIcon(type) {
  const clean = String(type || "").toLowerCase();

  if (clean.includes("booking")) return ["fa-solid fa-calendar-days", colors.gold];
  if (clean.includes("payment") || clean.includes("invoice")) return ["fa-solid fa-wallet", colors.green];
  if (clean.includes("complaint")) return ["fa-solid fa-triangle-exclamation", colors.red];
  if (clean.includes("visitor")) return ["fa-solid fa-id-badge", colors.orange];
  if (clean.includes("parcel")) return ["fa-solid fa-box", colors.green];
  if (clean.includes("staff")) return ["fa-solid fa-users-gear", colors.purple];
  if (clean.includes("property")) return ["fa-solid fa-building", colors.gold];
  if (clean.includes("resident")) return ["fa-solid fa-users", colors.blue];

  return ["fa-solid fa-bell", colors.gold];
}

function timeAgo(dateObj) {
  const now = new Date();
  const diff = now - dateObj;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return dateObj.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function renderActivityList(data) {
  const el = $("activityList");
  if (!el) return;

  const activities = data.latestActivities.slice(0, 7);

  if (!activities.length) {
    el.innerHTML = `<li><p>No activity found yet.</p></li>`;
    return;
  }

  el.innerHTML = activities.map((item) => {
    const [icon, color] = activityIcon(item.type);

    return `
      <li>
        <div class="activity-icon" style="background:${color}18;color:${color}">
          <i class="${icon}"></i>
        </div>

        <div>
          <b>${escapeHtml(item.title)}</b>
          <p>${escapeHtml(item.message)}</p>
        </div>

        <small>${escapeHtml(timeAgo(item.createdAt))}</small>
      </li>
    `;
  }).join("");
}

function renderComplaints(data) {
  const total = data.openComplaints + data.resolvedComplaints;

  const segments = [
    { label: "Open", value: data.openComplaints, color: colors.red },
    { label: "Resolved", value: data.resolvedComplaints, color: colors.green }
  ].filter((item) => item.value > 0);

  setText("complaintTotalCenter", total.toString());

  renderDoughnut(
    "complaintChart",
    segments.length ? segments : [{ label: "No complaints", value: 1, color: "#E8ECF2" }]
  );

  const list = $("complaintList");
  if (!list) return;

  if (!segments.length) {
    list.innerHTML = `<p class="empty-state">No complaint data yet.</p>`;
    return;
  }

  list.innerHTML = segments.map((item) => `
    <div class="legend-item">
      <i class="legend-dot" style="background:${item.color}"></i>
      <span>${item.label}</span>
      <b>${item.value}</b>
    </div>
  `).join("");
}

function scoreLabel(score) {
  if (score >= 85) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 40) return "Needs Attention";
  return "Critical";
}

function renderDashboard(data) {
  state.currentUnreadActivities = data.latestActivities.filter((item) => !item.isRead);

  setText("notificationCount", data.notificationCount > 99 ? "99+" : String(data.notificationCount));
  setText("heroScore", `${data.operationalScore}/100`);
  setText("heroRooms", `${data.totalRooms}`);
  setText("heroBeds", `${data.totalBeds}`);
  setText("healthScoreValue", `${data.operationalScore}`);
  setText("healthScoreLabel", scoreLabel(data.operationalScore));

  setText("occupancyValue", `${Math.round(data.occupancyRate)}%`);
  setText("occupancyChange", `${data.occupiedProperties} active stays`);
  setText("bookingValue", String(data.totalBookings));
  setText("bookingChange", `${data.newBookings} this month`);
  setText("revenueValue", money(data.totalRevenue));
  setText("complaintValue", String(data.openComplaints));
  setText("complaintChange", `${data.resolvedComplaints} resolved`);

  renderSpark("occupancySpark", data.bookingTrend, colors.gold);
  renderSpark("bookingSpark", data.bookingTrend, colors.purple);
  renderSpark("revenueSpark", data.revenueTrend, colors.green);
  renderSpark("complaintSpark", complaintTrend(data.openComplaints), colors.red);

  renderLineChart("bookingTrendChart", data.bookingTrend, colors.gold);
  renderLineChart("revenueTrendChart", data.revenueTrend, colors.green, true);

  renderPropertyList(data);

  renderInfoList("operationsList", [
    { icon: "fa-solid fa-building", title: "Total Properties", value: data.totalProperties, color: colors.gold },
    { icon: "fa-solid fa-door-open", title: "Total Rooms", value: data.totalRooms, color: colors.navy },
    { icon: "fa-solid fa-bed", title: "Total Beds", value: data.totalBeds, color: colors.green },
    { icon: "fa-solid fa-users-gear", title: "Staff Members", value: data.staffCount, color: colors.purple },
    { icon: "fa-solid fa-list-check", title: "Pending Tasks", value: data.pendingTasks, color: "#7A1024" }
  ]);

  renderInfoList("actionList", [
    { icon: "fa-solid fa-triangle-exclamation", title: "Open Complaints", value: data.openComplaints, color: "#7A1024" },
    { icon: "fa-solid fa-money-bill-wave", title: "Pending Payments", value: data.pendingPayments, color: "#E18A00" },
    { icon: "fa-solid fa-id-card", title: "Pending KYC", value: data.pendingKyc, color: colors.purple },
    { icon: "fa-solid fa-right-to-bracket", title: "Check-ins Today", value: data.checkInsToday, color: colors.green },
    { icon: "fa-solid fa-right-from-bracket", title: "Check-outs Today", value: data.checkOutsToday, color: "#313889" }
  ]);

  renderActivityList(data);
  renderComplaints(data);

  setTimeout(resizeCharts, 80);
}

function scheduleRender() {
  clearTimeout(state.debounce);
  state.debounce = setTimeout(() => renderDashboard(buildDashboardData()), 220);
}

function startLiveDashboard() {
  state.subscriptions.forEach((unsub) => {
    try {
      unsub();
    } catch (_) {}
  });

  state.subscriptions = [];

  Object.values(COLLECTIONS).forEach((collectionName) => {
    const unsub = onSnapshot(
      collection(db, collectionName),
      (snap) => {
        state.docs[collectionName] = snap.docs.map((d) => ({
          id: d.id,
          collection: collectionName,
          data: d.data()
        }));

        scheduleRender();
      },
      (error) => {
        console.error(`Firestore listener failed for ${collectionName}:`, error);
        state.docs[collectionName] = state.docs[collectionName] || [];
        scheduleRender();
      }
    );

    state.subscriptions.push(unsub);
  });
}

function updateGreeting() {
  const now = new Date();
  const hour = now.getHours();

  let greeting = "Good Night";

  if (hour >= 5 && hour < 12) {
    greeting = "Good Morning";
  } else if (hour >= 12 && hour < 17) {
    greeting = "Good Afternoon";
  } else if (hour >= 17 && hour < 21) {
    greeting = "Good Evening";
  }

  setText("greetingText", greeting);

  setText("liveTime", now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }));

  setText("liveDate", now.toLocaleDateString([], {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }));
}

async function loadProfile(user) {
  const candidates = [
    [COLLECTIONS.users, user.uid],
    ["staff_login_accounts", user.uid],
    [COLLECTIONS.staff, user.uid]
  ];

  for (const [collectionName, docId] of candidates) {
    try {
      const snap = await getDoc(doc(db, collectionName, docId));
      if (snap.exists()) return snap.data();
    } catch (_) {}
  }

  return {
    name: user.displayName || "Admin",
    email: user.email || ""
  };
}

function updateProfile(profile) {
  const user = state.user;
  const email = user?.email || "";

  const name =
    profile?.name ||
    profile?.staffName ||
    profile?.fullName ||
    profile?.displayName ||
    email.split("@")[0] ||
    "Admin";

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AD";

  setText("welcomeName", name.split(" ")[0] || "Admin");
  setText("adminAvatar", initials);
  setText("adminAvatarSmall", initials);
  setText("dropdownAdminName", name);
  setText("dropdownAdminEmail", email || "admin@email.com");

  const accountText = $("passwordAccountText");

  if (accountText) {
    accountText.textContent = email ? `Account: ${email}` : "Enter your new password.";
  }
}

function openNotifications() {
  const overlay = $("notificationOverlay");
  const list = $("notificationList");

  if (!overlay || !list) return;

  const unread = state.currentUnreadActivities || [];

  if (!unread.length) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>No unread notifications</strong><br>
        New bookings, complaints, payments, visitors and staff actions will appear here.
      </div>
    `;
  } else {
    list.innerHTML = unread.map((item) => {
      const [icon, color] = activityIcon(item.type);

      return `
        <article class="notification-item">
          <div class="icon" style="background:${color}18;color:${color}">
            <i class="${icon}"></i>
          </div>

          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.message)}</p>
            <small>${escapeHtml(timeAgo(item.createdAt))}</small>
          </div>
        </article>
      `;
    }).join("");
  }

  overlay.hidden = false;
}

async function closeNotifications() {
  const overlay = $("notificationOverlay");

  if (!overlay || overlay.hidden) return;

  overlay.hidden = true;

  const unread = state.currentUnreadActivities || [];

  if (!unread.length) return;

  await markNotificationsRead(unread);
}

async function markNotificationsRead(activities) {
  const items = activities.filter((item) => item.id && item.collection);

  items.forEach((item) => state.readKeys.add(item.readKey));

  localStorage.setItem(
    "ll_admin_read_notifications",
    JSON.stringify([...state.readKeys])
  );

  try {
    const batch = writeBatch(db);

    items.forEach((item) => {
      batch.update(doc(db, item.collection, item.id), {
        isRead: true,
        adminRead: true,
        readAt: serverTimestamp()
      });
    });

    await batch.commit();
  } catch (error) {
    console.warn("Firestore mark-read failed. Local read saved:", error);
  }

  scheduleRender();
}

function bindUiEvents() {
  const shell = $("adminShell");
  const sidebar = $("sidebar");
  const menuBtn = $("menuBtn");
  const mobileOverlay = $("mobileOverlay");

  menuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.innerWidth <= 980) {
      sidebar?.classList.toggle("open");
      mobileOverlay?.classList.toggle("show");
    } else {
      shell?.classList.toggle("sidebar-collapsed");
    }

    setTimeout(resizeCharts, 300);
  });

  mobileOverlay?.addEventListener("click", () => {
    sidebar?.classList.remove("open");
    mobileOverlay?.classList.remove("show");
  });

  const profileBtn = $("adminProfileBtn");
  const profileDropdown = $("profileDropdown");

  profileBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    profileDropdown?.classList.toggle("show");
  });

  profileDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    profileDropdown?.classList.remove("show");
  });

  const propertiesToggle = $("propertiesToggle");
  const propertiesGroup = $("propertiesGroup");

  propertiesToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    propertiesGroup?.classList.toggle("active");
  });

  $("notificationBtn")?.addEventListener("click", openNotifications);
  $("closeNotificationsBtn")?.addEventListener("click", closeNotifications);

  $("notificationOverlay")?.addEventListener("click", (event) => {
    if (event.target.id === "notificationOverlay") {
      closeNotifications();
    }
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });

  $("changePasswordBtn")?.addEventListener("click", () => {
    const modal = $("passwordModal");
    const form = $("passwordForm");

    if (!modal || !form) return;

    form.reset();
    modal.hidden = false;
  });

  $("cancelPasswordBtn")?.addEventListener("click", () => {
    $("passwordModal").hidden = true;
  });

  $("passwordModal")?.addEventListener("click", (event) => {
    if (event.target.id === "passwordModal") {
      $("passwordModal").hidden = true;
    }
  });

  $("passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = $("newPasswordInput")?.value.trim() || "";
    const confirmPassword = $("confirmPasswordInput")?.value.trim() || "";

    if (newPassword.length < 6) {
      toast("Password must be at least 6 characters.", true);
      return;
    }

    if (newPassword !== confirmPassword) {
      toast("Passwords do not match.", true);
      return;
    }

    try {
      await updatePassword(auth.currentUser, newPassword);
      $("passwordModal").hidden = true;
      toast("Password changed successfully.");
    } catch (error) {
      const message =
        error?.code === "auth/requires-recent-login"
          ? "For security, logout and login again, then change password."
          : error?.message || "Password change failed.";

      toast(message, true);
    }
  });

  window.addEventListener("resize", resizeCharts);
}

async function bootstrap() {
  updateGreeting();
  setInterval(updateGreeting, 1000);

  bindUiEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    state.user = user;

    try {
      state.profile = await loadProfile(user);
    } catch (error) {
      console.warn("Profile load failed:", error);
      state.profile = {};
    }

    updateProfile(state.profile);
    startLiveDashboard();

    try {
      const snapshotResults = await Promise.all(
        Object.values(COLLECTIONS).map(async (collectionName) => {
          const snap = await getDocs(collection(db, collectionName));

          return [
            collectionName,
            snap.docs.map((d) => ({
              id: d.id,
              collection: collectionName,
              data: d.data()
            }))
          ];
        })
      );

      snapshotResults.forEach(([collectionName, docs]) => {
        state.docs[collectionName] = docs;
      });

      renderDashboard(buildDashboardData());
    } catch (error) {
      console.error("Initial dashboard load failed:", error);
      toast("Dashboard data could not load. Check Firebase rules.", true);
    }
  });
}

document.addEventListener("DOMContentLoaded", bootstrap);