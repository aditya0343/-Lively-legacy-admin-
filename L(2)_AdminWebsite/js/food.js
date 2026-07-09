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
  deleteDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  foodPlans: "food_plans",
  foodSubscriptions: "food_subscriptions",
  foodFeedback: "food_feedback",
  residents: "residents",
  users: "users",
  properties: "properties"
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
  plans: [],
  subscriptions: [],
  feedback: [],
  residents: [],
  users: [],
  properties: [],
  currentPage: 1,
  rowsPerPage: 10,
  charts: {},
  savingPlan: false,
  savingSubscription: false,
  unsubscribers: []
};

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function safeNumber(value) {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
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

  if (value.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayInputValue() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

function addDaysInputValue(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function fromDateInput(value) {
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

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(safeNumber(value));
}

function formatShortCurrency(value) {
  const amount = safeNumber(value);

  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;

  return `₹${Math.round(amount)}`;
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "AD").trim();

  if (text.includes("@")) {
    return text.slice(0, 2).toUpperCase();
  }

  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

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
   Record mappers
------------------------------ */

function getPlanName(plan) {
  return firstNonEmpty([plan.planName, plan.name], "Food Plan");
}

function getPlanFoodType(plan) {
  return firstNonEmpty([plan.foodType, plan.type], "Vegetarian");
}

function getPlanCuisine(plan) {
  return firstNonEmpty([plan.cuisineType, plan.cuisine], "Both South & North");
}

function getPlanWeekdayMeals(plan) {
  return firstNonEmpty([plan.weekdayMeals], "Breakfast + Dinner");
}

function getPlanWeekendMeals(plan) {
  return firstNonEmpty([plan.weekendMeals], "Breakfast + Lunch + Dinner");
}

function getPlanMonthlyPrice(plan) {
  return safeNumber(plan.monthlyPrice ?? plan.price ?? plan.amount);
}

function getPlanBedCoffeeAvailable(plan) {
  return plan.bedCoffeeAvailable === true;
}

function getPlanBedCoffeePrice(plan) {
  return safeNumber(plan.bedCoffeePrice);
}

function getPlanEveningTiffinAvailable(plan) {
  return plan.eveningTiffinAvailable === true;
}

function getPlanEveningTiffinPrice(plan) {
  return safeNumber(plan.eveningTiffinPrice);
}

function isPlanActive(plan) {
  return plan.isActive !== false;
}

function getSubscriptionResidentName(item) {
  return firstNonEmpty([item.residentName, item.name], "Resident");
}

function getSubscriptionPhone(item) {
  return firstNonEmpty([item.phone, item.mobile], "");
}

function getSubscriptionEmail(item) {
  return firstNonEmpty([item.email], "");
}

function getSubscriptionPropertyName(item) {
  return firstNonEmpty([item.propertyName, item.property], "No Property");
}

function getSubscriptionPlanName(item) {
  return firstNonEmpty([item.planName], "Food Plan");
}

function getSubscriptionFoodType(item) {
  return firstNonEmpty([item.foodType], "Vegetarian");
}

function getSubscriptionCuisine(item) {
  return firstNonEmpty([item.cuisineType], "Both South & North");
}

function getSubscriptionStatus(item) {
  return firstNonEmpty([item.status, item.subscriptionStatus], "Active");
}

function getSubscriptionStatusKey(item) {
  return normalize(getSubscriptionStatus(item));
}

function getSubscriptionTotal(item) {
  return safeNumber(item.totalAmount ?? item.amount);
}

function getSubscriptionPaid(item) {
  return safeNumber(item.amountReceived ?? item.paidAmount);
}

function getSubscriptionPending(item) {
  const explicit = safeNumber(item.pendingAmount ?? item.balanceAmount);
  if (explicit > 0) return explicit;

  const calculated = getSubscriptionTotal(item) - getSubscriptionPaid(item);
  return Math.max(calculated, 0);
}

function getSubscriptionPaymentStatus(item) {
  return firstNonEmpty(
    [item.paymentStatus],
    getSubscriptionPending(item) <= 0
      ? "Paid"
      : getSubscriptionPaid(item) > 0
        ? "Partially Paid"
        : "Due"
  );
}

function getSubscriptionPaymentKey(item) {
  return normalize(getSubscriptionPaymentStatus(item));
}

function getFeedbackScore(item) {
  return safeNumber(item.rating ?? item.score);
}

/* -----------------------------
   Options
------------------------------ */

function getPropertyName(property) {
  return firstNonEmpty([property.propertyName, property.name, property.title], property.id);
}

function getResidentOptions() {
  const propertyNameById = new Map(
    state.properties.map((property) => [property.id, getPropertyName(property)])
  );

  const map = new Map();

  state.residents.forEach((resident) => {
    const propertyId = firstNonEmpty([resident.propertyId, resident.property_id], "");

    map.set(resident.id, {
      id: resident.id,
      name: firstNonEmpty([resident.name, resident.fullName, resident.residentName], resident.id),
      phone: firstNonEmpty([resident.phone, resident.mobile], ""),
      email: firstNonEmpty([resident.email], ""),
      propertyId,
      propertyName: firstNonEmpty([resident.propertyName], propertyNameById.get(propertyId) || "")
    });
  });

  state.users.forEach((user) => {
    if (map.has(user.id)) return;

    const role = normalize(user.role || user.userRole);
    const looksResident = !role || ["resident", "tenant", "student"].includes(role);

    if (!looksResident) return;

    const propertyId = firstNonEmpty([user.propertyId, user.property_id], "");

    map.set(user.id, {
      id: user.id,
      name: firstNonEmpty([user.name, user.fullName, user.displayName], user.id),
      phone: firstNonEmpty([user.phone, user.mobile], ""),
      email: firstNonEmpty([user.email], ""),
      propertyId,
      propertyName: firstNonEmpty([user.propertyName], propertyNameById.get(propertyId) || "")
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getPropertyOptions() {
  return state.properties.map((property) => ({
    id: property.id,
    name: getPropertyName(property)
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function getActivePlans() {
  return state.plans.filter(isPlanActive).sort((a, b) => {
    return getPlanName(a).localeCompare(getPlanName(b));
  });
}

function findResident(id) {
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

function findProperty(id) {
  return getPropertyOptions().find((property) => property.id === id) || null;
}

function findPlan(id) {
  return state.plans.find((plan) => plan.id === id) || null;
}

/* -----------------------------
   Auth + layout
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
   Firebase listeners
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
  listenCollection("plans", COLLECTIONS.foodPlans);
  listenCollection("subscriptions", COLLECTIONS.foodSubscriptions);
  listenCollection("feedback", COLLECTIONS.foodFeedback);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("properties", COLLECTIONS.properties);
}

/* -----------------------------
   Render
------------------------------ */

function renderPage() {
  renderFilterOptions();
  renderStats();
  renderCharts();
  renderFoodPlans();
  renderSubscriptions();
}

function renderFilterOptions() {
  const propertyFilter = $("propertyFilter");
  const mealPlanFilter = $("mealPlanFilter");
  const statusFilter = $("subscriptionStatusFilter");
  const paymentFilter = $("paymentStatusFilter");

  const selectedProperty = propertyFilter?.value || "All Properties";
  const selectedPlan = mealPlanFilter?.value || "All Plans";
  const selectedStatus = statusFilter?.value || "All Statuses";
  const selectedPayment = paymentFilter?.value || "All Payments";

  const propertyNames = [
    ...new Set(state.subscriptions.map(getSubscriptionPropertyName).filter(Boolean))
  ].sort();

  const planNames = [
    ...new Set([
      ...state.plans.map(getPlanName),
      ...state.subscriptions.map(getSubscriptionPlanName)
    ].filter(Boolean))
  ].sort();

  const statuses = [
    ...new Set(state.subscriptions.map(getSubscriptionStatus).filter(Boolean))
  ].sort();

  const payments = [
    ...new Set(state.subscriptions.map(getSubscriptionPaymentStatus).filter(Boolean))
  ].sort();

  if (propertyFilter) {
    propertyFilter.innerHTML = `
      <option value="All Properties">All Properties</option>
      ${propertyNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
    `;

    propertyFilter.value = propertyNames.includes(selectedProperty) ? selectedProperty : "All Properties";
  }

  if (mealPlanFilter) {
    mealPlanFilter.innerHTML = `
      <option value="All Plans">All Plans</option>
      ${planNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
    `;

    mealPlanFilter.value = planNames.includes(selectedPlan) ? selectedPlan : "All Plans";
  }

  if (statusFilter) {
    statusFilter.innerHTML = `
      <option value="All Statuses">All Statuses</option>
      ${statuses.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
    `;

    statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : "All Statuses";
  }

  if (paymentFilter) {
    paymentFilter.innerHTML = `
      <option value="All Payments">All Payments</option>
      ${payments.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
    `;

    paymentFilter.value = payments.includes(selectedPayment) ? selectedPayment : "All Payments";
  }
}

function getFoodDataSummary() {
  const subscriptions = state.subscriptions;

  const active = subscriptions.filter((item) => getSubscriptionStatusKey(item) === "active").length;
  const paused = subscriptions.filter((item) => getSubscriptionStatusKey(item) === "paused").length;
  const cancelled = subscriptions.filter((item) => getSubscriptionStatusKey(item) === "cancelled").length;

  const totalBillAmount = subscriptions.reduce((sum, item) => sum + getSubscriptionTotal(item), 0);
  const collectedAmount = subscriptions.reduce((sum, item) => sum + getSubscriptionPaid(item), 0);
  const pendingAmount = subscriptions.reduce((sum, item) => sum + getSubscriptionPending(item), 0);

  const scores = state.feedback.map(getFeedbackScore).filter((score) => score > 0);
  const avgScore = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 0;

  return {
    active,
    paused,
    cancelled,
    totalBillAmount,
    collectedAmount,
    pendingAmount,
    avgScore,
    feedbackCount: scores.length
  };
}

function renderStats() {
  const data = getFoodDataSummary();

  setText("activeSubscriptionsValue", data.active);
  setText("activeSubscriptionsSub", "Food active plans");

  setText("foodRevenueValue", formatShortCurrency(data.totalBillAmount));
  setText("foodRevenueSub", "Total bill amount");

  setText("paymentsCollectedValue", formatShortCurrency(data.collectedAmount));
  setText("paymentsCollectedSub", "Received amount");

  setText("pendingPaymentsValue", formatShortCurrency(data.pendingAmount));
  setText("pendingPaymentsSub", "Pending amount");

  setText("pausedPlansValue", data.paused);
  setText("pausedPlansSub", "Temporarily paused");

  setText("feedbackScoreValue", data.avgScore <= 0 ? "-" : data.avgScore.toFixed(1));
  setText("feedbackScoreSub", `${data.feedbackCount} feedbacks`);
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

function renderCharts() {
  const data = getFoodDataSummary();

  renderPaymentChart(data);
  renderStatusBars(data);
}

function renderPaymentChart(data) {
  const total = data.collectedAmount + data.pendingAmount;

  setText("paymentChartCenter", formatShortCurrency(total || 0));

  createChart("paymentCollectionChart", {
    type: "doughnut",
    data: {
      labels: total ? ["Collected", "Pending"] : ["No Data"],
      datasets: [
        {
          data: total ? [data.collectedAmount, data.pendingAmount] : [1],
          backgroundColor: total ? [COLORS.green, COLORS.red] : [COLORS.grey],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (!total) return "No payment data";
              return `${context.label}: ${formatCurrency(context.raw)}`;
            }
          }
        }
      }
    }
  });

  const legend = $("paymentLegend");
  if (!legend) return;

  legend.innerHTML = `
    <div class="legend-row">
      <span><i class="legend-dot" style="background:${COLORS.green}"></i>Collected</span>
      <strong>${formatCurrency(data.collectedAmount)}</strong>
    </div>

    <div class="legend-row">
      <span><i class="legend-dot" style="background:${COLORS.red}"></i>Pending</span>
      <strong>${formatCurrency(data.pendingAmount)}</strong>
    </div>
  `;
}

function renderStatusBars(data) {
  const container = $("subscriptionStatusBars");
  if (!container) return;

  const total = data.active + data.paused + data.cancelled;
  const rows = [
    { label: "Active", value: data.active, color: COLORS.green },
    { label: "Paused", value: data.paused, color: COLORS.orange },
    { label: "Cancelled", value: data.cancelled, color: COLORS.red }
  ];

  if (!total) {
    container.innerHTML = `<div class="empty-card">No subscription data yet.</div>`;
    return;
  }

  container.innerHTML = rows.map((row) => {
    const width = percent(row.value, total);

    return `
      <div class="status-row">
        <span>${escapeHtml(row.label)}</span>
        <div class="status-track">
          <div class="status-fill" style="width:${width}%;background:${row.color}"></div>
        </div>
        <strong>${row.value}</strong>
      </div>
    `;
  }).join("");
}

function renderFoodPlans() {
  const container = $("mealPlansGrid");
  if (!container) return;

  const plans = getActivePlans();

  if (!plans.length) {
    container.innerHTML = `
      <div class="empty-card">No food plans yet. Click Add Food Type to create your first plan.</div>
    `;
    return;
  }

  container.innerHTML = plans.map((plan) => {
    const name = getPlanName(plan);
    const foodType = getPlanFoodType(plan);
    const cuisine = getPlanCuisine(plan);

    return `
      <article class="meal-plan-card">
        <div class="plan-top">
          <div class="plan-icon">
            <i class="fa-solid fa-utensils"></i>
          </div>

          <div>
            <h4>${escapeHtml(name)}</h4>
            <p>${escapeHtml(foodType)} • ${escapeHtml(cuisine)}</p>
          </div>
        </div>

        <h3>${formatCurrency(getPlanMonthlyPrice(plan))} / month</h3>

        <div class="small-line">
          <span>Mon-Fri</span>
          <strong>${escapeHtml(getPlanWeekdayMeals(plan))}</strong>
        </div>

        <div class="small-line">
          <span>Sat-Sun</span>
          <strong>${escapeHtml(getPlanWeekendMeals(plan))}</strong>
        </div>

        ${getPlanBedCoffeeAvailable(plan) ? `
          <div class="small-line">
            <span>Bed Coffee</span>
            <strong>${formatCurrency(getPlanBedCoffeePrice(plan))}</strong>
          </div>
        ` : ""}

        ${getPlanEveningTiffinAvailable(plan) ? `
          <div class="small-line">
            <span>Evening Tiffin</span>
            <strong>${formatCurrency(getPlanEveningTiffinPrice(plan))}</strong>
          </div>
        ` : ""}

        <div class="badge-row">
          ${plan.hygieneEnabled !== false ? `<span class="mini-badge"><i class="fa-solid fa-shield-check"></i> Hygiene</span>` : ""}
          ${plan.brandRecipeEnabled !== false ? `<span class="mini-badge"><i class="fa-solid fa-award"></i> Brand Recipe</span>` : ""}
        </div>

        <div class="plan-actions">
          <button class="delete-plan-btn" type="button" data-delete-plan="${escapeHtml(plan.id)}">
            <i class="fa-solid fa-trash"></i>
            Delete Plan
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function getFilteredSubscriptions() {
  let items = [...state.subscriptions];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("subscriptionSearchInput")?.value);
  const search = localSearch || globalSearch;

  const propertyFilter = $("propertyFilter")?.value || "All Properties";
  const planFilter = $("mealPlanFilter")?.value || "All Plans";
  const statusFilter = $("subscriptionStatusFilter")?.value || "All Statuses";
  const paymentFilter = $("paymentStatusFilter")?.value || "All Payments";

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        getSubscriptionResidentName(item),
        getSubscriptionPhone(item),
        getSubscriptionEmail(item),
        getSubscriptionPropertyName(item),
        getSubscriptionPlanName(item),
        getSubscriptionFoodType(item),
        getSubscriptionCuisine(item),
        getSubscriptionPaymentStatus(item),
        getSubscriptionStatus(item)
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (propertyFilter !== "All Properties") {
    items = items.filter((item) => getSubscriptionPropertyName(item) === propertyFilter);
  }

  if (planFilter !== "All Plans") {
    items = items.filter((item) => getSubscriptionPlanName(item) === planFilter);
  }

  if (statusFilter !== "All Statuses") {
    items = items.filter((item) => getSubscriptionStatus(item) === statusFilter);
  }

  if (paymentFilter !== "All Payments") {
    items = items.filter((item) => getSubscriptionPaymentStatus(item) === paymentFilter);
  }

  items.sort((a, b) => {
    const dateA = toDate(a.createdAt) || new Date(1900, 0, 1);
    const dateB = toDate(b.createdAt) || new Date(1900, 0, 1);
    return dateB - dateA;
  });

  return items;
}

function renderSubscriptions() {
  const body = $("subscriptionTableBody");
  const summary = $("tableSummary");

  if (!body) return;

  const subscriptions = getFilteredSubscriptions();
  const totalPages = Math.max(1, Math.ceil(subscriptions.length / state.rowsPerPage));

  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const paginated = subscriptions.slice(start, start + state.rowsPerPage);

  setText("subscriptionSubText", `${subscriptions.length} food subscription records shown`);

  if (!paginated.length) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="empty-row">No food subscription records found.</td>
      </tr>
    `;

    if (summary) summary.textContent = "Showing 0 subscriptions";
    renderPagination(totalPages);
    return;
  }

  body.innerHTML = paginated.map((item) => {
    const name = getSubscriptionResidentName(item);
    const phoneOrEmail = firstNonEmpty([getSubscriptionPhone(item), getSubscriptionEmail(item)], "No phone added");
    const paymentStatus = getSubscriptionPaymentStatus(item);
    const paymentKey = getSubscriptionPaymentKey(item);
    const status = getSubscriptionStatus(item);
    const statusKey = getSubscriptionStatusKey(item);
    const canResume = statusKey === "paused";

    const paymentClass = paymentKey.includes("paid")
      ? "green"
      : paymentKey.includes("partial")
        ? "orange"
        : "red";

    const statusClass = statusKey === "active"
      ? "green"
      : statusKey === "paused"
        ? "orange"
        : "red";

    return `
      <tr>
        <td>
          <div class="resident-cell">
            <div class="resident-avatar-cell">${escapeHtml(getInitials(name))}</div>
            <div>
              <strong class="cell-title">${escapeHtml(name)}</strong>
              <span class="cell-sub">${escapeHtml(phoneOrEmail)}</span>
            </div>
          </div>
        </td>

        <td>
          <strong class="cell-title">${escapeHtml(getSubscriptionPropertyName(item))}</strong>
        </td>

        <td>
          <strong class="cell-title">${escapeHtml(getSubscriptionPlanName(item))}</strong>
        </td>

        <td>
          <strong class="cell-title">${escapeHtml(getSubscriptionFoodType(item))}</strong>
          <span class="cell-sub">${escapeHtml(getSubscriptionCuisine(item))}</span>
        </td>

        <td>
          <strong class="cell-title">${formatCurrency(getSubscriptionTotal(item))}</strong>
          <span class="cell-sub">Due ${formatCurrency(getSubscriptionPending(item))}</span>
        </td>

        <td>
          <span class="tiny-chip ${paymentClass}">${escapeHtml(paymentStatus)}</span>
        </td>

        <td>
          <span class="tiny-chip ${statusClass}">${escapeHtml(status)}</span>
        </td>

        <td>${escapeHtml(formatDate(item.renewalDate))}</td>

        <td>
          <div class="row-actions">
            <button class="action-toggle-btn" type="button" data-toggle-subscription="${escapeHtml(item.id)}">
              <i class="fa-solid ${canResume ? "fa-play-circle" : "fa-pause-circle"}"></i>
              ${canResume ? "Resume" : "Pause"}
            </button>

            <button class="delete-subscription-btn" type="button" data-delete-subscription="${escapeHtml(item.id)}">
              <i class="fa-solid fa-trash"></i>
              Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (summary) {
    summary.textContent = `Showing ${start + 1} to ${start + paginated.length} of ${subscriptions.length} subscriptions`;
  }

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = $("pagination");
  if (!container) return;

  container.innerHTML = "";

  for (let page = 1; page <= totalPages; page++) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = page;
    button.className = page === state.currentPage ? "active" : "";

    button.addEventListener("click", () => {
      state.currentPage = page;
      renderSubscriptions();
    });

    container.appendChild(button);
  }
}

/* -----------------------------
   Delete functions
------------------------------ */

async function deleteFoodPlan(id) {
  const plan = state.plans.find((item) => item.id === id);
  const planName = plan ? getPlanName(plan) : "this food plan";

  const linkedSubscriptions = state.subscriptions.filter((item) => {
    return String(item.planId || "") === String(id) || getSubscriptionPlanName(item) === planName;
  }).length;

  const message = linkedSubscriptions
    ? `Delete "${planName}"?\n\n${linkedSubscriptions} subscription(s) are linked with this plan. Existing subscriptions will not be deleted automatically.`
    : `Delete "${planName}"?`;

  if (!window.confirm(message)) return;

  try {
    await deleteDoc(doc(db, COLLECTIONS.foodPlans, id));
    showToast("Food plan deleted successfully.");
  } catch (error) {
    console.error("Delete food plan failed:", error);
    showToast(`Failed to delete food plan: ${error.message}`, "error");
  }
}

async function deleteFoodSubscription(id) {
  const item = state.subscriptions.find((subscription) => subscription.id === id);
  const residentName = item ? getSubscriptionResidentName(item) : "this subscription";

  if (!window.confirm(`Delete food subscription for "${residentName}"?`)) return;

  try {
    await deleteDoc(doc(db, COLLECTIONS.foodSubscriptions, id));
    showToast("Food subscription deleted successfully.");
  } catch (error) {
    console.error("Delete subscription failed:", error);
    showToast(`Failed to delete subscription: ${error.message}`, "error");
  }
}

/* -----------------------------
   Modal helpers
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
   Add Food Plan
------------------------------ */

function resetFoodPlanForm() {
  if ($("foodPlanForm")) $("foodPlanForm").reset();

  $("planNameInput").value = "Vegetarian Plan";
  $("foodTypeInput").value = "Vegetarian";
  $("cuisineTypeInput").value = "Both South & North";
  $("weekdayMealsInput").value = "Breakfast + Dinner";
  $("weekendMealsInput").value = "Breakfast + Lunch + Dinner";
  $("monthlyPriceInput").value = "3600";
  $("bedCoffeeAvailableInput").checked = true;
  $("bedCoffeePriceInput").value = "600";
  $("eveningTiffinAvailableInput").checked = true;
  $("eveningTiffinPriceInput").value = "900";
  $("hygieneEnabledInput").checked = true;
  $("brandRecipeEnabledInput").checked = true;
  $("planDescriptionInput").value =
    "Monday to Friday breakfast and dinner. Saturday and Sunday three meals. South food and North food available. Hygienic preparation with branded recipes.";

  updateFoodPlanOptionalFields();
}

function updateFoodPlanOptionalFields() {
  $("bedCoffeePriceWrap").hidden = !$("bedCoffeeAvailableInput").checked;
  $("eveningTiffinPriceWrap").hidden = !$("eveningTiffinAvailableInput").checked;
}

async function saveFoodPlan(event) {
  event.preventDefault();

  if (state.savingPlan) return;

  const form = $("foodPlanForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  state.savingPlan = true;
  $("savePlanBtn").disabled = true;
  $("savePlanBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const ref = doc(collection(db, COLLECTIONS.foodPlans));

    const monthlyPrice = safeNumber($("monthlyPriceInput").value);
    const bedCoffeeAvailable = $("bedCoffeeAvailableInput").checked;
    const eveningTiffinAvailable = $("eveningTiffinAvailableInput").checked;

    await setDoc(ref, {
      planId: ref.id,
      planName: $("planNameInput").value.trim(),
      foodType: $("foodTypeInput").value,
      cuisineType: $("cuisineTypeInput").value,
      weekdayMeals: "Breakfast + Dinner",
      weekendMeals: "Breakfast + Lunch + Dinner",
      monthlyPrice,
      bedCoffeeAvailable,
      bedCoffeeChargeable: bedCoffeeAvailable,
      bedCoffeePrice: bedCoffeeAvailable ? safeNumber($("bedCoffeePriceInput").value) : 0,
      eveningTiffinAvailable,
      eveningTiffinChargeable: eveningTiffinAvailable,
      eveningTiffinPrice: eveningTiffinAvailable ? safeNumber($("eveningTiffinPriceInput").value) : 0,
      hygieneEnabled: $("hygieneEnabledInput").checked,
      brandRecipeEnabled: $("brandRecipeEnabledInput").checked,
      description: $("planDescriptionInput").value.trim(),
      status: "Active",
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Food type pricing saved successfully.");
    closeModal("foodPlanModal");
  } catch (error) {
    console.error("Food plan save failed:", error);
    showToast(`Failed to save food plan: ${error.message}`, "error");
  } finally {
    state.savingPlan = false;
    $("savePlanBtn").disabled = false;
    $("savePlanBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Food Plan`;
  }
}

/* -----------------------------
   Add Food Subscription
------------------------------ */

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

function resetFoodSubscriptionForm() {
  if ($("foodSubscriptionForm")) $("foodSubscriptionForm").reset();

  const residents = getResidentOptions();
  const properties = getPropertyOptions();
  const plans = getActivePlans();

  fillSelect(
    "subscriptionResidentInput",
    residents.map((resident) => ({
      id: resident.id,
      label: `${resident.name}${resident.phone ? ` • ${resident.phone}` : ""}`
    })),
    "Select resident"
  );

  fillSelect(
    "subscriptionPropertyInput",
    properties.map((property) => ({
      id: property.id,
      label: property.name
    })),
    "Select property"
  );

  fillSelect(
    "subscriptionPlanInput",
    plans.map((plan) => ({
      id: plan.id,
      label: `${getPlanName(plan)} • ${getPlanFoodType(plan)} • ${formatCurrency(getPlanMonthlyPrice(plan))}`
    })),
    "Select food plan"
  );

  $("subscriptionPaymentModeInput").value = "UPI";
  $("subscriptionStatusInput").value = "Active";
  $("subscriptionStartDateInput").value = todayInputValue();
  $("subscriptionRenewalDateInput").value = addDaysInputValue(30);
  $("subscriptionAmountReceivedInput").value = "";
  $("subscriptionNotesInput").value = "";
  $("includeBedCoffeeInput").checked = false;
  $("includeEveningTiffinInput").checked = false;

  renderSelectedPlanInfo();
  updateBillingSummary();
}

function selectedSubscriptionPlan() {
  const planId = $("subscriptionPlanInput")?.value;
  return planId ? findPlan(planId) : null;
}

function renderSelectedPlanInfo() {
  const plan = selectedSubscriptionPlan();
  const box = $("selectedPlanInfo");
  const addonBox = $("addonOptionsBox");
  const bedWrap = $("includeBedCoffeeWrap");
  const tiffinWrap = $("includeEveningTiffinWrap");

  if (!box || !addonBox || !bedWrap || !tiffinWrap) return;

  $("includeBedCoffeeInput").checked = false;
  $("includeEveningTiffinInput").checked = false;

  if (!plan) {
    box.hidden = true;
    addonBox.hidden = true;
    bedWrap.hidden = true;
    tiffinWrap.hidden = true;
    updateBillingSummary();
    return;
  }

  box.hidden = false;

  box.innerHTML = `
    <h4>${escapeHtml(getPlanName(plan))}</h4>
    <div class="small-line">
      <span>Food Type</span>
      <strong>${escapeHtml(getPlanFoodType(plan))}</strong>
    </div>
    <div class="small-line">
      <span>Cuisine</span>
      <strong>${escapeHtml(getPlanCuisine(plan))}</strong>
    </div>
    <div class="small-line">
      <span>Monday-Friday</span>
      <strong>${escapeHtml(getPlanWeekdayMeals(plan))}</strong>
    </div>
    <div class="small-line">
      <span>Saturday-Sunday</span>
      <strong>${escapeHtml(getPlanWeekendMeals(plan))}</strong>
    </div>
    <div class="small-line">
      <span>Base Amount</span>
      <strong>${formatCurrency(getPlanMonthlyPrice(plan))}</strong>
    </div>
  `;

  const hasBedCoffee = getPlanBedCoffeeAvailable(plan);
  const hasEveningTiffin = getPlanEveningTiffinAvailable(plan);

  addonBox.hidden = !(hasBedCoffee || hasEveningTiffin);
  bedWrap.hidden = !hasBedCoffee;
  tiffinWrap.hidden = !hasEveningTiffin;

  setText("bedCoffeeChargeText", `Customer requested add-on. Charge: ${formatCurrency(getPlanBedCoffeePrice(plan))}`);
  setText("eveningTiffinChargeText", `Customer requested add-on. Charge: ${formatCurrency(getPlanEveningTiffinPrice(plan))}`);

  updateBillingSummary();
}

function calculateSubscriptionTotal() {
  const plan = selectedSubscriptionPlan();
  if (!plan) return 0;

  let total = getPlanMonthlyPrice(plan);

  if ($("includeBedCoffeeInput")?.checked && getPlanBedCoffeeAvailable(plan)) {
    total += getPlanBedCoffeePrice(plan);
  }

  if ($("includeEveningTiffinInput")?.checked && getPlanEveningTiffinAvailable(plan)) {
    total += getPlanEveningTiffinPrice(plan);
  }

  return total;
}

function updateBillingSummary() {
  const total = calculateSubscriptionTotal();
  const received = safeNumber($("subscriptionAmountReceivedInput")?.value);
  const pending = Math.max(total - received, 0);

  setText("summaryTotalAmount", formatCurrency(total));
  setText("summaryReceivedAmount", formatCurrency(received));
  setText("summaryPendingAmount", formatCurrency(pending));
}

async function saveFoodSubscription(event) {
  event.preventDefault();

  if (state.savingSubscription) return;

  const form = $("foodSubscriptionForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const residentId = $("subscriptionResidentInput").value;
  const propertyId = $("subscriptionPropertyInput").value;
  const planId = $("subscriptionPlanInput").value;

  const resident = findResident(residentId);
  const property = findProperty(propertyId);
  const plan = findPlan(planId);

  if (!resident || !property || !plan) {
    showToast("Selected resident, property or plan not found.", "error");
    return;
  }

  state.savingSubscription = true;
  $("saveSubscriptionBtn").disabled = true;
  $("saveSubscriptionBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const total = calculateSubscriptionTotal();
    const received = safeNumber($("subscriptionAmountReceivedInput").value);
    const pending = Math.max(total - received, 0);

    const paymentStatus =
      received >= total && total > 0
        ? "Paid"
        : received > 0
          ? "Partially Paid"
          : "Due";

    const includeBedCoffee = $("includeBedCoffeeInput").checked && getPlanBedCoffeeAvailable(plan);
    const includeEveningTiffin = $("includeEveningTiffinInput").checked && getPlanEveningTiffinAvailable(plan);

    const ref = doc(collection(db, COLLECTIONS.foodSubscriptions));

    await setDoc(ref, {
      subscriptionId: ref.id,
      residentId: resident.id,
      residentName: resident.name,
      phone: resident.phone,
      email: resident.email,
      propertyId: property.id,
      propertyName: property.name,
      planId: plan.id,
      planName: getPlanName(plan),
      foodType: getPlanFoodType(plan),
      cuisineType: getPlanCuisine(plan),
      weekdayMeals: getPlanWeekdayMeals(plan),
      weekendMeals: getPlanWeekendMeals(plan),
      baseMonthlyPrice: getPlanMonthlyPrice(plan),
      includeBedCoffee,
      bedCoffeeCharge: includeBedCoffee ? getPlanBedCoffeePrice(plan) : 0,
      includeEveningTiffin,
      eveningTiffinCharge: includeEveningTiffin ? getPlanEveningTiffinPrice(plan) : 0,
      totalAmount: total,
      amountReceived: received,
      paidAmount: received,
      pendingAmount: pending,
      paymentStatus,
      paymentMode: $("subscriptionPaymentModeInput").value,
      status: $("subscriptionStatusInput").value,
      subscriptionStatus: $("subscriptionStatusInput").value,
      startDate: Timestamp.fromDate(fromDateInput($("subscriptionStartDateInput").value)),
      renewalDate: Timestamp.fromDate(fromDateInput($("subscriptionRenewalDateInput").value)),
      notes: $("subscriptionNotesInput").value.trim(),
      hygieneEnabled: plan.hygieneEnabled !== false,
      brandRecipeEnabled: plan.brandRecipeEnabled !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Food subscription saved successfully.");
    closeModal("foodSubscriptionModal");
  } catch (error) {
    console.error("Food subscription save failed:", error);
    showToast(`Failed to save subscription: ${error.message}`, "error");
  } finally {
    state.savingSubscription = false;
    $("saveSubscriptionBtn").disabled = false;
    $("saveSubscriptionBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Subscription`;
  }
}

async function toggleSubscription(id) {
  const item = state.subscriptions.find((sub) => sub.id === id);
  if (!item) return;

  const current = getSubscriptionStatusKey(item);
  const newStatus = current === "paused" ? "Active" : "Paused";

  try {
    await setDoc(
      doc(db, COLLECTIONS.foodSubscriptions, id),
      {
        status: newStatus,
        subscriptionStatus: newStatus,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast(`Subscription ${newStatus.toLowerCase()} successfully.`);
  } catch (error) {
    console.error("Toggle subscription failed:", error);
    showToast(`Failed to update subscription: ${error.message}`, "error");
  }
}

/* -----------------------------
   Events
------------------------------ */

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Food management refreshed.");
  });

  $("addFoodPlanBtn")?.addEventListener("click", () => {
    resetFoodPlanForm();
    openModal("foodPlanModal");
  });

  $("sectionAddPlanBtn")?.addEventListener("click", () => {
    resetFoodPlanForm();
    openModal("foodPlanModal");
  });

  $("addSubscriptionBtn")?.addEventListener("click", () => {
    resetFoodSubscriptionForm();
    openModal("foodSubscriptionModal");
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

  $("bedCoffeeAvailableInput")?.addEventListener("change", updateFoodPlanOptionalFields);
  $("eveningTiffinAvailableInput")?.addEventListener("change", updateFoodPlanOptionalFields);

  $("foodPlanForm")?.addEventListener("submit", saveFoodPlan);

  $("foodSubscriptionForm")?.addEventListener("submit", saveFoodSubscription);

  $("subscriptionResidentInput")?.addEventListener("change", () => {
    const resident = findResident($("subscriptionResidentInput").value);

    if (resident && resident.propertyId) {
      $("subscriptionPropertyInput").value = resident.propertyId;
    }
  });

  $("subscriptionPlanInput")?.addEventListener("change", renderSelectedPlanInfo);
  $("includeBedCoffeeInput")?.addEventListener("change", updateBillingSummary);
  $("includeEveningTiffinInput")?.addEventListener("change", updateBillingSummary);
  $("subscriptionAmountReceivedInput")?.addEventListener("input", updateBillingSummary);

  $("subscriptionStartDateInput")?.addEventListener("change", () => {
    const start = fromDateInput($("subscriptionStartDateInput").value);
    start.setDate(start.getDate() + 30);
    $("subscriptionRenewalDateInput").value = start.toISOString().slice(0, 10);
  });

  [
    "globalSearchInput",
    "subscriptionSearchInput",
    "propertyFilter",
    "mealPlanFilter",
    "subscriptionStatusFilter",
    "paymentStatusFilter"
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", () => {
      state.currentPage = 1;
      renderSubscriptions();
    });

    element.addEventListener("change", () => {
      state.currentPage = 1;
      renderSubscriptions();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("subscriptionSearchInput").value = "";
    $("propertyFilter").value = "All Properties";
    $("mealPlanFilter").value = "All Plans";
    $("subscriptionStatusFilter").value = "All Statuses";
    $("paymentStatusFilter").value = "All Payments";

    state.currentPage = 1;
    renderSubscriptions();
  });

  $("mealPlansGrid")?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-plan]");
    if (!deleteButton) return;

    deleteFoodPlan(deleteButton.dataset.deletePlan);
  });

  $("subscriptionTableBody")?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-subscription]");
    if (deleteButton) {
      deleteFoodSubscription(deleteButton.dataset.deleteSubscription);
      return;
    }

    const toggleButton = event.target.closest("[data-toggle-subscription]");
    if (toggleButton) {
      toggleSubscription(toggleButton.dataset.toggleSubscription);
    }
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