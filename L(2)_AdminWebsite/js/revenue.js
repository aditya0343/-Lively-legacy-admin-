import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  setDoc,
  serverTimestamp,
  Timestamp,
  increment
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

console.log("revenue.js loaded");

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  invoices: "invoices",
  transactions: "transactions",
  residents: "residents",
  users: "users",
  properties: "properties",
  billingFields: "billing_field_settings",
  billingEntities: "billing_entities",
  billingAdjustments: "billing_adjustments"
};

const COLORS = {
  navy: "#061B32",
  gold: "#B68B2D",
  green: "#2E8A4E",
  red: "#7A1024",
  orange: "#E76D12",
  purple: "#7054B8",
  blue: "#4167A9",
  teal: "#24B8B8"
};

const state = {
  invoices: [],
  transactions: [],
  residents: [],
  users: [],
  properties: [],
  billingFields: [],
  billingEntities: [],
  billingAdjustments: [],
  currentPage: 1,
  rowsPerPage: 10,
  charts: {},
  invoiceLines: [],
  saving: false,
  currentDetailInvoice: null,
  unsubscribers: []
};

let firebaseStarted = false;

function text(value) {
  return String(value ?? "").trim();
}

function normal(value) {
  return text(value).toLowerCase();
}

function cleanLabel(value) {
  const raw = text(value);

  if (!raw) return "";

  return raw
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1).toLowerCase())
    .join(" ");
}

function normalizeCategory(value) {
  const raw = normal(value);

  if (raw.includes("rent")) return "Rent";
  if (raw.includes("food")) return "Food";
  if (raw.includes("deposit")) return "Deposit";
  if (raw.includes("maintenance")) return "Maintenance";
  if (raw.includes("adjustment")) return "Adjustment";

  return cleanLabel(value || "Custom") || "Custom";
}

function normalizeTaxMode(value) {
  return normal(value).includes("included") ? "included" : "excluded";
}

function amount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (value !== undefined && value !== null && text(value) !== "") {
      return value;
    }
  }

  return "";
}

function firstText(data, keys) {
  const value = firstValue(data, keys);

  if (value && typeof value === "object" && !Array.isArray(value)) return "";

  return text(value);
}

function firstNumber(data, keys) {
  for (const key of keys) {
    const value = amount(data?.[key]);

    if (value !== 0) return value;
  }

  return 0;
}

function toDate(value) {
  if (!value) return null;

  if (value.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }

  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInput(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date = new Date()) {
  return date.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric"
  });
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

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount(value));
}

function shortMoney(value) {
  const n = amount(value);

  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}K`;

  return money(n);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function initials(value) {
  const raw = text(value || "AD");

  if (raw.includes("@")) return raw.slice(0, 2).toUpperCase();

  const parts = raw.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function toast(message, isError = false) {
  const el = $("toast");
  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function isThisMonth(value) {
  const date = toDate(value);
  if (!date) return false;

  const now = new Date();

  return date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
}

function isThisYear(value) {
  const date = toDate(value);
  if (!date) return false;

  return date.getFullYear() === new Date().getFullYear();
}

function inLastMonths(value, months) {
  const date = toDate(value);
  if (!date) return false;

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  return date >= start && date <= now;
}

function isPastDue(value) {
  const date = toDate(value);
  if (!date) return false;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return date < today;
}

function statusColor(status) {
  const raw = normal(status);

  if (raw.includes("paid") && !raw.includes("partial")) return COLORS.green;
  if (raw.includes("partial")) return COLORS.orange;
  if (raw.includes("overdue")) return COLORS.red;
  if (raw.includes("due") || raw.includes("pending") || raw.includes("unpaid")) return COLORS.red;

  return COLORS.navy;
}

function categoryColor(category) {
  const raw = normal(category);

  if (raw.includes("rent")) return COLORS.green;
  if (raw.includes("food")) return COLORS.gold;
  if (raw.includes("deposit")) return COLORS.orange;
  if (raw.includes("maintenance")) return COLORS.purple;
  if (raw.includes("adjustment")) return COLORS.teal;

  return COLORS.blue;
}

function soft(color) {
  return `${color}18`;
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.hidden = false;
  modal.removeAttribute("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.hidden = true;
  modal.setAttribute("hidden", "");
  document.body.style.overflow = "";
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

/* PROPERTY + RESIDENT HELPERS */

function propertyName(property) {
  return firstText(property, ["propertyName", "name", "title"]) || property?.id || "Property";
}

function getPropertyById(idOrName) {
  const key = text(idOrName);

  return state.properties.find((property) => {
    return property.id === key ||
      text(property.propertyId) === key ||
      text(property.propertyName) === key ||
      text(property.name) === key;
  });
}

function getPropertyNameById(idOrName) {
  const property = getPropertyById(idOrName);
  return property ? propertyName(property) : text(idOrName || "No Property");
}

function residentName(resident) {
  return firstText(resident, ["residentName", "name", "fullName", "customerName"]) || "Resident";
}

function getResidentById(id) {
  const key = text(id);

  return state.residents.find((resident) => {
    return resident.id === key ||
      text(resident.residentId) === key ||
      text(resident.residentCode) === key ||
      text(resident.userId) === key ||
      text(resident.customerId) === key ||
      text(resident.phone) === key;
  });
}

function activeEntities() {
  return state.billingEntities.filter((entity) => entity.isActive !== false);
}

function activeFields() {
  return state.billingFields.filter((field) => field.isActive !== false);
}

function activeAdjustments() {
  return state.billingAdjustments.filter((adjustment) => {
    const status = normal(adjustment.status || adjustment.billingStatus);

    return adjustment.isActive !== false &&
      !["adjusted", "cancelled", "canceled", "deleted"].includes(status);
  });
}

/* INVOICE MAPPING */

function getInvoiceLines(invoice) {
  if (!Array.isArray(invoice.lineItems)) return [];

  return invoice.lineItems.map((line) => {
    const enteredAmount = firstNumber(line, ["enteredAmount", "customAmount", "amount"]);
    const taxRate = firstNumber(line, ["taxRate"]);
    const taxAmount = firstNumber(line, ["taxAmount"]);
    const total = firstNumber(line, ["total"]) || enteredAmount + taxAmount;

    return {
      name: firstText(line, ["name", "fieldName"]) || "Field",
      category: normalizeCategory(firstText(line, ["category"]) || "Custom"),
      enteredAmount,
      subtotal: firstNumber(line, ["subtotal"]) || enteredAmount,
      taxRate,
      taxAmount,
      total,
      taxMode: normalizeTaxMode(firstText(line, ["taxMode"]))
    };
  });
}

function invoiceTotal(invoice) {
  const lines = getInvoiceLines(invoice);
  const calculated = lines.reduce((sum, line) => sum + amount(line.total), 0);

  return firstNumber(invoice, ["totalAmount", "amount", "invoiceAmount"]) || calculated;
}

function invoicePaid(invoice) {
  return firstNumber(invoice, ["amountReceived", "paidAmount", "receivedAmount", "amountPaid"]);
}

function invoiceBalance(invoice) {
  const stored = firstNumber(invoice, ["balanceAmount", "pendingAmount", "outstandingAmount", "dueAmount"]);

  if (stored) return stored;

  return Math.max(invoiceTotal(invoice) - invoicePaid(invoice), 0);
}

function paymentStatusFromValues(total, received, dueDate) {
  const totalAmount = amount(total);
  const receivedAmount = amount(received);

  if (receivedAmount >= totalAmount && totalAmount > 0) return "Paid";
  if (receivedAmount > 0 && receivedAmount < totalAmount) return "Partially Paid";
  if (dueDate && isPastDue(dueDate)) return "Overdue";

  return "Due";
}

function invoiceStatus(invoice) {
  return cleanLabel(
    firstText(invoice, ["paymentStatus", "status", "invoiceStatus"]) ||
    paymentStatusFromValues(
      invoiceTotal(invoice),
      invoicePaid(invoice),
      toDate(firstValue(invoice, ["dueDate", "paymentDueDate"]))
    )
  );
}

function invoiceCategory(invoice) {
  const line = getInvoiceLines(invoice)[0];

  return normalizeCategory(
    firstText(invoice, ["category", "invoiceType", "type"]) ||
    line?.category ||
    "Custom"
  );
}

function invoiceRecord(invoice) {
  const propertyId = firstText(invoice, ["propertyId", "property_id"]);
  const residentId = firstText(invoice, ["residentId", "residentDocId", "userId"]);
  const resident = getResidentById(residentId);

  const total = invoiceTotal(invoice);
  const paid = invoicePaid(invoice);
  const balance = invoiceBalance(invoice);

  const dueDate = firstValue(invoice, ["dueDate", "paymentDueDate"]);
  const createdAt = firstValue(invoice, ["createdAt", "created_at"]);

  return {
    id: invoice.id,
    invoiceNo: firstText(invoice, ["invoiceNo", "invoiceId"]) || invoice.id,
    residentId,
    residentName: firstText(invoice, ["residentName", "name", "guestName"]) || (resident ? residentName(resident) : "Resident"),
    phone: firstText(invoice, ["phone", "mobile"]) || firstText(resident, ["phone", "mobile"]),
    email: firstText(invoice, ["email"]) || firstText(resident, ["email"]),
    propertyId,
    propertyName: firstText(invoice, ["propertyName", "property"]) || getPropertyNameById(propertyId),
    billingEntityId: firstText(invoice, ["billingEntityId"]),
    billingEntityName: firstText(invoice, ["billingEntityName", "vendorName"]),
    billingEntityType: firstText(invoice, ["billingEntityType", "vendorType"]),
    vendorPan: firstText(invoice, ["vendorPan", "pan"]),
    vendorGstin: firstText(invoice, ["vendorGstin", "gstin"]),
    vendorBankName: firstText(invoice, ["vendorBankName", "bankName"]),
    vendorAccountNumber: firstText(invoice, ["vendorAccountNumber", "accountNumber"]),
    vendorIfsc: firstText(invoice, ["vendorIfsc", "ifsc"]),
    vendorAddress: firstText(invoice, ["vendorAddress", "address"]),
    billingPeriod: firstText(invoice, ["billingPeriod", "period"]) || "-",
    dueDate: toDate(dueDate),
    category: invoiceCategory(invoice),
    lineItems: getInvoiceLines(invoice),
    subtotal: firstNumber(invoice, ["subtotal"]),
    taxAmount: firstNumber(invoice, ["taxAmount", "tax"]),
    totalAmount: total,
    grossTotal: firstNumber(invoice, ["grossTotal", "beforeCreditTotal", "originalTotal"]) || total,
    adjustmentAmount: firstNumber(invoice, ["adjustmentAmount", "creditAmount", "referralCreditAmount"]),
    amountReceived: paid,
    balanceAmount: balance,
    paymentStatus: invoiceStatus(invoice),
    paymentMode: firstText(invoice, ["paymentMode", "mode"]) || "Not Set",
    createdAt: toDate(createdAt),
    raw: invoice
  };
}

function invoices() {
  return state.invoices.map(invoiceRecord);
}

/* CALCULATIONS */

function totalInvoiceRevenue() {
  return invoices().reduce((sum, invoice) => sum + invoice.totalAmount, 0);
}

function collectedAmount() {
  const transactionCollected = state.transactions.reduce((sum, transaction) => {
    return sum + firstNumber(transaction, ["amount", "paidAmount"]);
  }, 0);

  if (transactionCollected > 0) return transactionCollected;

  return invoices().reduce((sum, invoice) => sum + invoice.amountReceived, 0);
}

function collectedThisMonth() {
  const txRecords = state.transactions.filter((tx) => {
    return isThisMonth(firstValue(tx, ["createdAt", "created_at", "paymentDate", "paidAt"]));
  });

  if (txRecords.length) {
    return txRecords.reduce((sum, tx) => {
      return sum + firstNumber(tx, ["amount", "paidAmount"]);
    }, 0);
  }

  return invoices()
    .filter((invoice) => isThisMonth(invoice.createdAt))
    .reduce((sum, invoice) => sum + invoice.amountReceived, 0);
}

function outstandingDues() {
  return invoices().reduce((sum, invoice) => sum + invoice.balanceAmount, 0);
}

function overdueInvoices() {
  return invoices().filter((invoice) => {
    return invoice.balanceAmount > 0 &&
      invoice.dueDate &&
      isPastDue(invoice.dueDate);
  }).length;
}

function collectionRate() {
  const total = totalInvoiceRevenue();
  const collected = collectedAmount();

  if (total <= 0) return 0;

  return Math.round(Math.min(collected / total, 1) * 100);
}

function avgRevenuePerProperty() {
  const propertyIds = new Set(
    invoices()
      .map((invoice) => invoice.propertyId || invoice.propertyName)
      .filter(Boolean)
  );

  return propertyIds.size ? totalInvoiceRevenue() / propertyIds.size : 0;
}

function upcomingDues() {
  return invoices()
    .filter((invoice) => invoice.balanceAmount > 0)
    .sort((a, b) => {
      return (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0);
    })
    .slice(0, 5);
}

function groupSegments(list, keyGetter, valueGetter) {
  const map = new Map();

  list.forEach((item) => {
    const key = cleanLabel(keyGetter(item) || "Unknown");
    const value = amount(valueGetter(item));

    map.set(key, (map.get(key) || 0) + value);
  });

  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/* RENDER */

function renderPage() {
  renderStats();
  renderFilters();
  renderInvoiceList();
  renderCharts();
  renderBars();
  renderUpcomingDues();
  renderVendorList();
  renderFieldList();
  renderInvoiceFormOptions();
}

function renderStats() {
  const total = totalInvoiceRevenue();
  const collected = collectedAmount();
  const collectedMonth = collectedThisMonth();
  const due = outstandingDues();
  const overdue = overdueInvoices();
  const rate = collectionRate();

  setText("totalRevenueValue", shortMoney(total));
  setText("totalRevenueSub", `${money(total)} billed`);

  setText("collectedMonthValue", shortMoney(collectedMonth));
  setText("collectedMonthSub", `${money(collectedMonth)} this month`);

  setText("avgRevenueValue", shortMoney(avgRevenuePerProperty()));
  setText("avgRevenueSub", `${state.properties.length} properties`);

  setText("outstandingDuesValue", shortMoney(due));
  setText("outstandingDuesSub", `${money(due)} pending`);

  setText("overdueInvoicesValue", overdue);
  setText("overdueInvoicesSub", `${overdue} past due date`);

  setText("collectionRateValue", `${rate}%`);
  setText("collectionRateSub", `${money(collected)} collected`);
}

function selectOptions(id, values, current) {
  const select = $(id);
  if (!select) return;

  select.innerHTML = values.map((value) => {
    return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
  }).join("");

  select.value = values.includes(current) ? current : values[0];
}

function renderFilters() {
  const inv = invoices();

  selectOptions(
    "propertyFilter",
    ["All Properties", ...new Set(inv.map((item) => item.propertyName).filter(Boolean))],
    $("propertyFilter")?.value || "All Properties"
  );

  selectOptions(
    "categoryFilter",
    ["All Categories", ...new Set(inv.map((item) => item.category).filter(Boolean))],
    $("categoryFilter")?.value || "All Categories"
  );

  selectOptions(
    "statusFilter",
    ["All Statuses", ...new Set(inv.map((item) => item.paymentStatus).filter(Boolean))],
    $("statusFilter")?.value || "All Statuses"
  );

  selectOptions(
    "modeFilter",
    ["All Modes", ...new Set(inv.map((item) => item.paymentMode).filter(Boolean))],
    $("modeFilter")?.value || "All Modes"
  );
}

function matchesPeriod(invoice, period) {
  if (period === "All Time") return true;

  const date = invoice.createdAt || invoice.dueDate;

  if (period === "This Month") return isThisMonth(date);
  if (period === "Last 3 Months") return inLastMonths(date, 3);
  if (period === "Last 6 Months") return inLastMonths(date, 6);
  if (period === "This Year") return isThisYear(date);

  return true;
}

function filteredInvoices() {
  let list = invoices();

  const search = normal($("invoiceSearchInput")?.value) || normal($("globalSearchInput")?.value);
  const property = $("propertyFilter")?.value || "All Properties";
  const category = $("categoryFilter")?.value || "All Categories";
  const status = $("statusFilter")?.value || "All Statuses";
  const mode = $("modeFilter")?.value || "All Modes";
  const period = $("periodFilter")?.value || "This Month";
  const sort = $("sortFilter")?.value || "Recently Added";

  if (search) {
    list = list.filter((invoice) => {
      const haystack = [
        invoice.residentName,
        invoice.phone,
        invoice.email,
        invoice.invoiceNo,
        invoice.propertyName,
        invoice.billingEntityName,
        invoice.category,
        invoice.totalAmount,
        invoice.paymentStatus,
        invoice.paymentMode
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (property !== "All Properties") {
    list = list.filter((invoice) => invoice.propertyName === property);
  }

  if (category !== "All Categories") {
    list = list.filter((invoice) => invoice.category === category);
  }

  if (status !== "All Statuses") {
    list = list.filter((invoice) => invoice.paymentStatus === status);
  }

  if (mode !== "All Modes") {
    list = list.filter((invoice) => invoice.paymentMode === mode);
  }

  if (period) {
    list = list.filter((invoice) => matchesPeriod(invoice, period));
  }

  list.sort((a, b) => {
    if (sort === "Name A-Z") return a.residentName.localeCompare(b.residentName);
    if (sort === "Amount High") return b.totalAmount - a.totalAmount;
    if (sort === "Due Date") return (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0);

    return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
  });

  return list;
}

function renderInvoiceList() {
  const box = $("invoiceList");
  if (!box) return;

  const list = filteredInvoices();
  const totalPages = Math.max(1, Math.ceil(list.length / state.rowsPerPage));

  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const page = list.slice(start, start + state.rowsPerPage);

  setText("invoiceCountText", `${list.length} invoice records shown`);

  if (!page.length) {
    box.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        <strong>No invoices found</strong>
        <span>Create an invoice or add a booking to generate rent and food invoices. Also check Date Range: All Time.</span>
      </div>
    `;

    setText("tableSummary", "Showing 0 records");
    renderPagination(totalPages);
    return;
  }

  box.innerHTML = page.map((invoice) => {
    const color = statusColor(invoice.paymentStatus);

    return `
      <article class="invoice-row">
        <div class="invoice-avatar">${escapeHtml(initials(invoice.residentName).slice(0, 1))}</div>

        <div class="row-text">
          <strong>${escapeHtml(invoice.residentName)}</strong>
          <span>${escapeHtml(invoice.phone || invoice.email || "No contact added")}</span>
        </div>

        <div class="row-text hide-tablet">
          <strong>${escapeHtml(invoice.invoiceNo)}</strong>
          <span>${escapeHtml(invoice.billingPeriod)}</span>
        </div>

        <div class="row-text hide-tablet">
          <strong>${escapeHtml(invoice.propertyName)}</strong>
          <span>${escapeHtml(invoice.billingEntityName || invoice.category)}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(money(invoice.totalAmount))}</strong>
          <span>${invoice.adjustmentAmount > 0 ? `Credit -${escapeHtml(money(invoice.adjustmentAmount))}` : `Due ${escapeHtml(formatDate(invoice.dueDate))}`}</span>
        </div>

        <div class="hide-tablet">
          <span class="tiny-chip" style="color:${color};background:${soft(color)}">
            ${escapeHtml(invoice.paymentStatus)}
          </span>
        </div>

        <div class="desktop-col row-text">
          <strong>${escapeHtml(invoice.paymentMode)}</strong>
          <span>Paid ${escapeHtml(money(invoice.amountReceived))}</span>
        </div>

        <div class="invoice-actions">
          <button type="button" data-view-invoice="${escapeHtml(invoice.id)}" title="View Invoice">
            <i class="fa-regular fa-eye"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");

  box.querySelectorAll("[data-view-invoice]").forEach((button) => {
    button.addEventListener("click", () => {
      const invoice = invoices().find((item) => item.id === button.dataset.viewInvoice);
      if (invoice) openInvoiceDetail(invoice);
    });
  });

  setText("tableSummary", `Showing ${start + 1} to ${start + page.length} of ${list.length} records`);

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const box = $("pagination");
  if (!box) return;

  box.innerHTML = "";

  for (let page = 1; page <= totalPages; page++) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = page;
    button.className = page === state.currentPage ? "active" : "";

    button.addEventListener("click", () => {
      state.currentPage = page;
      renderInvoiceList();
    });

    box.appendChild(button);
  }
}

function renderCharts() {
  renderCollectionTrend();
  renderRevenueSplit();
}

function renderCollectionTrend() {
  const labels = [];
  const values = [];
  const now = new Date();

  for (let index = 5; index >= 0; index--) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);

    labels.push(date.toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit"
    }));

    const value = state.transactions.length
      ? state.transactions
        .filter((tx) => {
          const created = toDate(firstValue(tx, ["createdAt", "created_at", "paymentDate", "paidAt"]));
          return created &&
            created.getMonth() === date.getMonth() &&
            created.getFullYear() === date.getFullYear();
        })
        .reduce((sum, tx) => sum + firstNumber(tx, ["amount", "paidAmount"]), 0)
      : invoices()
        .filter((invoice) => {
          const created = invoice.createdAt;
          return created &&
            created.getMonth() === date.getMonth() &&
            created.getFullYear() === date.getFullYear();
        })
        .reduce((sum, invoice) => sum + invoice.amountReceived, 0);

    values.push(value);
  }

  createChart("collectionTrendChart", {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: COLORS.gold,
          borderRadius: 7,
          maxBarThickness: 34
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => money(context.parsed.y)
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => shortMoney(value),
            font: { size: 10 }
          },
          grid: { color: "rgba(6,27,50,0.06)" }
        },
        x: {
          ticks: { font: { size: 10 } },
          grid: { display: false }
        }
      }
    }
  });
}

function renderRevenueSplit() {
  const segments = groupSegments(invoices(), (invoice) => invoice.category, (invoice) => invoice.totalAmount);
  const labels = segments.map((item) => item.label);
  const values = segments.map((item) => item.value);
  const total = values.reduce((sum, item) => sum + item, 0);

  setText("revenueSplitCenter", shortMoney(total));

  const colors = labels.map((label) => categoryColor(label));

  createChart("revenueSplitChart", {
    type: "doughnut",
    data: {
      labels: labels.length ? labels : ["No Data"],
      datasets: [
        {
          data: values.length ? values : [1],
          backgroundColor: values.length ? colors : ["#edf0f5"],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      cutout: "68%",
      plugins: {
        legend: { display: false }
      }
    }
  });

  const legend = $("revenueSplitLegend");
  if (!legend) return;

  if (!segments.length) {
    legend.innerHTML = `
      <div class="legend-row-top">
        <span>No Data</span>
        <strong>₹0</strong>
      </div>
    `;
    return;
  }

  legend.innerHTML = segments.slice(0, 6).map((item) => {
    const color = categoryColor(item.label);
    const share = percent(item.value, total);

    return `
      <div class="legend-row">
        <div class="legend-row-top">
          <span class="legend-label">
            <i class="legend-dot" style="background:${color}"></i>
            ${escapeHtml(item.label)}
          </span>
          <strong>${share}% · ${escapeHtml(shortMoney(item.value))}</strong>
        </div>
      </div>
    `;
  }).join("");
}

function renderBars() {
  const inv = invoices();

  renderBarList(
    "statusBars",
    groupSegments(inv, (invoice) => invoice.paymentStatus, (invoice) => invoice.totalAmount),
    statusColor
  );

  renderBarList(
    "modeBars",
    groupSegments(inv, (invoice) => invoice.paymentMode, (invoice) => invoice.amountReceived),
    () => COLORS.gold
  );

  renderBarList(
    "categoryBars",
    groupSegments(inv, (invoice) => invoice.category, (invoice) => invoice.totalAmount),
    categoryColor
  );
}

function renderBarList(id, items, colorGetter) {
  const box = $(id);
  if (!box) return;

  if (!items.length) {
    box.innerHTML = `
      <div class="empty-state">
        <strong>No data yet</strong>
        <span>Records will appear after invoices are added.</span>
      </div>
    `;
    return;
  }

  const max = Math.max(...items.map((item) => item.value), 1);

  box.innerHTML = items.slice(0, 6).map((item) => {
    const color = colorGetter(item.label);
    const width = Math.round((item.value / max) * 100);

    return `
      <div class="bar-row">
        <div class="bar-row-top">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(shortMoney(item.value))}</strong>
        </div>

        <div class="progress-track">
          <div class="progress-fill" style="width:${width}%;background:${color}"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderUpcomingDues() {
  const box = $("upcomingDuesList");
  if (!box) return;

  const dues = upcomingDues();

  if (!dues.length) {
    box.innerHTML = `
      <div class="empty-state">
        <strong>No upcoming dues</strong>
        <span>All invoices are paid or no due invoices were found.</span>
      </div>
    `;
    return;
  }

  box.innerHTML = dues.map((invoice) => {
    return `
      <div class="due-item">
        <div class="invoice-avatar">${escapeHtml(initials(invoice.residentName).slice(0, 1))}</div>

        <div>
          <strong>${escapeHtml(invoice.residentName)}</strong>
          <span>${escapeHtml(invoice.invoiceNo)} · Due ${escapeHtml(formatDate(invoice.dueDate))}</span>
        </div>

        <div class="due-amount">${escapeHtml(money(invoice.balanceAmount))}</div>
      </div>
    `;
  }).join("");
}

/* INVOICE FORM */

function defaultBillingPeriod() {
  return monthLabel(new Date());
}

function resetInvoiceForm() {
  $("invoiceForm")?.reset();

  state.invoiceLines = [];

  if ($("invoicePeriodInput")) $("invoicePeriodInput").value = defaultBillingPeriod();

  const due = new Date();
  due.setDate(due.getDate() + 7);

  if ($("invoiceDueDateInput")) $("invoiceDueDateInput").value = dateInput(due);
  if ($("invoicePaymentModeInput")) $("invoicePaymentModeInput").value = "UPI";

  renderInvoiceFormOptions();
  renderInvoiceLines();
  renderAdjustmentBox();
  updateInvoiceSummary();
}

function renderInvoiceFormOptions() {
  const residentSelect = $("invoiceResidentInput");
  const propertySelect = $("invoicePropertyInput");
  const entitySelect = $("invoiceEntityInput");

  if (residentSelect) {
    const current = residentSelect.value;

    residentSelect.innerHTML = `
      <option value="">Choose resident</option>
      ${state.residents.map((resident) => `
        <option value="${escapeHtml(resident.id)}">
          ${escapeHtml(residentName(resident))} • ${escapeHtml(firstText(resident, ["phone", "mobile"]) || "No phone")}
        </option>
      `).join("")}
    `;

    if (state.residents.some((resident) => resident.id === current)) {
      residentSelect.value = current;
    }
  }

  if (propertySelect) {
    const current = propertySelect.value;

    propertySelect.innerHTML = `
      <option value="">Choose property</option>
      ${state.properties.map((property) => `
        <option value="${escapeHtml(property.id)}">${escapeHtml(propertyName(property))}</option>
      `).join("")}
    `;

    if (state.properties.some((property) => property.id === current)) {
      propertySelect.value = current;
    }
  }

  if (entitySelect) {
    const current = entitySelect.value;
    const entities = activeEntities();

    entitySelect.innerHTML = `
      <option value="">Choose vendor</option>
      ${entities.map((entity) => `
        <option value="${escapeHtml(entity.id)}">
          ${escapeHtml(firstText(entity, ["name", "vendorName"]) || "Vendor")} • ${escapeHtml(firstText(entity, ["type", "entityType"]) || "Custom")}
        </option>
      `).join("")}
    `;

    if (entities.some((entity) => entity.id === current)) {
      entitySelect.value = current;
    }

    if ($("noVendorHelp")) $("noVendorHelp").hidden = entities.length > 0;
  }
}

function lineToTotals(line) {
  const entered = amount(line.amount);
  const taxRate = amount(line.taxRate);
  const taxMode = normalizeTaxMode(line.taxMode);

  let subtotal = entered;
  let taxAmount = 0;
  let total = entered;

  if (taxMode === "included") {
    const divisor = 1 + taxRate / 100;
    subtotal = divisor <= 0 ? entered : entered / divisor;
    taxAmount = entered - subtotal;
    total = entered;
  } else {
    taxAmount = subtotal * taxRate / 100;
    total = subtotal + taxAmount;
  }

  return {
    name: text(line.name) || "Field",
    category: normalizeCategory(line.category),
    enteredAmount: entered,
    amount: entered,
    customAmount: entered,
    subtotal,
    taxRate,
    taxAmount,
    total,
    taxMode,
    taxModeLabel: taxMode === "included" ? "Tax Included" : "Tax Not Included"
  };
}

function pendingAdjustmentsForInvoice() {
  const residentId = $("invoiceResidentInput")?.value || "";
  const period = text($("invoicePeriodInput")?.value);

  if (!residentId) return [];

  return activeAdjustments().filter((adjustment) => {
    const adjustmentResidentId = firstText(adjustment, ["residentId", "userId", "customerId"]);
    const adjustmentPeriod = firstText(adjustment, ["billingPeriod", "period"]);

    const residentMatch = adjustmentResidentId === residentId;

    const periodMatch = !adjustmentPeriod ||
      !period ||
      normal(adjustmentPeriod) === normal(period);

    return residentMatch && periodMatch;
  });
}

function invoiceTotals() {
  const billLines = state.invoiceLines.map(lineToTotals);

  const grossSubtotal = billLines.reduce((sum, line) => sum + line.subtotal, 0);
  const taxAmount = billLines.reduce((sum, line) => sum + line.taxAmount, 0);
  const grossTotal = billLines.reduce((sum, line) => sum + line.total, 0);

  const adjustments = pendingAdjustmentsForInvoice();
  const appliedAdjustments = [];
  const adjustmentLines = [];

  let remaining = grossTotal;
  let adjustmentAmount = 0;

  if (grossTotal > 0) {
    adjustments.forEach((adjustment) => {
      if (remaining <= 0) return;

      const adjustmentAmountValue = firstNumber(adjustment, ["amount", "remainingAmount", "creditAmount"]);
      if (adjustmentAmountValue <= 0) return;

      const applied = Math.min(adjustmentAmountValue, remaining);
      adjustmentAmount += applied;
      remaining -= applied;

      const name = firstText(adjustment, ["description", "type"]) || "Adjustment";

      adjustmentLines.push({
        name,
        category: "Adjustment",
        enteredAmount: -applied,
        amount: -applied,
        customAmount: -applied,
        subtotal: -applied,
        taxRate: 0,
        taxAmount: 0,
        total: -applied,
        taxMode: "excluded",
        taxModeLabel: "Tax Not Included"
      });

      appliedAdjustments.push({
        adjustment,
        appliedAmount: applied
      });
    });
  }

  const lines = [...billLines, ...adjustmentLines];
  const subtotal = grossSubtotal - adjustmentAmount;
  const total = Math.max(grossTotal - adjustmentAmount, 0);
  const received = amount($("invoiceAmountReceivedInput")?.value);
  const balance = Math.max(total - received, 0);

  return {
    lines,
    billLines,
    subtotal,
    taxAmount,
    total,
    amountReceived: received,
    balance,
    grossSubtotal,
    grossTotal,
    adjustmentAmount,
    appliedAdjustments
  };
}

function renderAdjustmentBox() {
  const card = $("adjustmentCard");
  const list = $("adjustmentList");

  if (!card || !list) return;

  const adjustments = pendingAdjustmentsForInvoice();

  if (!adjustments.length) {
    card.hidden = true;
    list.innerHTML = "";
    return;
  }

  card.hidden = false;

  list.innerHTML = adjustments.map((adjustment) => {
    const label = firstText(adjustment, ["description", "type"]) || "Credit";
    const value = firstNumber(adjustment, ["amount", "remainingAmount", "creditAmount"]);

    return `
      <div class="adjustment-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(money(value))}</strong>
      </div>
    `;
  }).join("");
}

function renderInvoiceLines() {
  const box = $("invoiceLinesBox");
  if (!box) return;

  if (!state.invoiceLines.length) {
    box.innerHTML = `
      <div class="dashed-empty">
        <i class="fa-solid fa-receipt"></i>
        <strong>No billing items added</strong>
        <span>Add rent, food, deposit, maintenance or a custom amount.</span>
      </div>
    `;

    updateInvoiceSummary();
    return;
  }

  box.innerHTML = state.invoiceLines.map((line, index) => {
    return `
      <div class="invoice-line">
        <label>
          <span>Name</span>
          <input data-line-field="name" data-line-index="${index}" value="${escapeHtml(line.name)}" />
        </label>

        <label>
          <span>Category</span>
          <input data-line-field="category" data-line-index="${index}" value="${escapeHtml(line.category)}" />
        </label>

        <label>
          <span>Amount</span>
          <input type="number" data-line-field="amount" data-line-index="${index}" value="${escapeHtml(line.amount)}" />
        </label>

        <label>
          <span>Tax %</span>
          <input type="number" data-line-field="taxRate" data-line-index="${index}" value="${escapeHtml(line.taxRate)}" />
        </label>

        <label>
          <span>Tax Mode</span>
          <select data-line-field="taxMode" data-line-index="${index}">
            <option value="excluded" ${line.taxMode === "excluded" ? "selected" : ""}>Tax Not Included</option>
            <option value="included" ${line.taxMode === "included" ? "selected" : ""}>Tax Included</option>
          </select>
        </label>

        <button type="button" data-remove-line="${index}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
  }).join("");

  box.querySelectorAll("[data-line-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.lineIndex);
      const field = input.dataset.lineField;

      state.invoiceLines[index][field] = input.value;
      updateInvoiceSummary();
    });

    input.addEventListener("change", () => {
      const index = Number(input.dataset.lineIndex);
      const field = input.dataset.lineField;

      state.invoiceLines[index][field] = input.value;
      updateInvoiceSummary();
    });
  });

  box.querySelectorAll("[data-remove-line]").forEach((button) => {
    button.addEventListener("click", () => {
      state.invoiceLines.splice(Number(button.dataset.removeLine), 1);
      renderInvoiceLines();
    });
  });

  updateInvoiceSummary();
}

function updateInvoiceSummary() {
  const totals = invoiceTotals();

  setText("summarySubtotal", money(totals.subtotal));
  setText("summaryTax", money(totals.taxAmount));
  setText("summaryCredits", `-${money(totals.adjustmentAmount)}`);
  setText("summaryTotal", money(totals.total));
  setText("summaryReceived", money(totals.amountReceived));
  setText("summaryBalance", money(totals.balance));
}

function openBillingItemPicker() {
  const list = $("billingFieldPickList");

  if (list) {
    const fields = activeFields();

    if (!fields.length) {
      list.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-sliders"></i>
          <strong>No saved billing fields</strong>
          <span>Open Billing Fields and create default fields first.</span>
        </div>
      `;
    } else {
      list.innerHTML = fields.map((field) => {
        const name = firstText(field, ["name", "fieldName"]) || "Field";
        const category = normalizeCategory(firstText(field, ["category"]) || "Custom");
        const defaultAmount = firstNumber(field, ["defaultAmount", "amount"]);
        const taxRate = firstNumber(field, ["taxRate"]);
        const taxMode = normalizeTaxMode(firstText(field, ["taxMode"]));

        return `
          <button class="sheet-row" type="button" data-pick-field="${escapeHtml(field.id)}">
            <span class="sheet-icon" style="color:${categoryColor(category)};background:${soft(categoryColor(category))}">
              <i class="fa-solid fa-receipt"></i>
            </span>

            <div>
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(category)} • ${escapeHtml(money(defaultAmount))} • Tax ${taxRate}% • ${taxMode === "included" ? "Included" : "Not Included"}</small>
            </div>

            <i class="fa-solid fa-chevron-right"></i>
          </button>
        `;
      }).join("");
    }

    list.querySelectorAll("[data-pick-field]").forEach((button) => {
      button.addEventListener("click", () => {
        const field = activeFields().find((item) => item.id === button.dataset.pickField);
        if (!field) return;

        state.invoiceLines.push({
          name: firstText(field, ["name", "fieldName"]) || "Field",
          category: normalizeCategory(firstText(field, ["category"]) || "Custom"),
          amount: firstNumber(field, ["defaultAmount", "amount"]) || "",
          taxRate: firstNumber(field, ["taxRate"]),
          taxMode: normalizeTaxMode(firstText(field, ["taxMode"]))
        });

        closeModal("billingItemModal");
        renderInvoiceLines();
      });
    });
  }

  openModal("billingItemModal");
}

function addCustomInvoiceLine() {
  state.invoiceLines.push({
    name: "Custom Amount",
    category: "Custom",
    amount: "",
    taxRate: 0,
    taxMode: "excluded"
  });

  closeModal("billingItemModal");
  renderInvoiceLines();
}

function validateInvoice() {
  const residentId = $("invoiceResidentInput")?.value || "";
  const propertyId = $("invoicePropertyInput")?.value || "";
  const entityId = $("invoiceEntityInput")?.value || "";

  if (!residentId) {
    toast("Select resident first.", true);
    return false;
  }

  if (!propertyId) {
    toast("Select property first.", true);
    return false;
  }

  if (!entityId) {
    toast("Select billing entity/vendor first.", true);
    return false;
  }

  if (!state.invoiceLines.length) {
    toast("Add at least one billing item.", true);
    return false;
  }

  const totals = invoiceTotals();

  if (totals.grossTotal <= 0) {
    toast("Invoice total must be greater than zero before adjustments.", true);
    return false;
  }

  for (const line of state.invoiceLines) {
    if (!text(line.name)) {
      toast("Every billing item needs a name.", true);
      return false;
    }

    if (amount(line.amount) <= 0) {
      toast(`${line.name} amount must be greater than zero.`, true);
      return false;
    }
  }

  return true;
}

function previewInvoice() {
  if (!validateInvoice()) return;

  const totals = invoiceTotals();
  const content = $("invoicePreviewContent");

  if (!content) return;

  content.innerHTML = `
    <div class="detail-section">
      <h4>Invoice Preview</h4>

      <div class="preview-row">
        <span>Billing Period</span>
        <strong>${escapeHtml($("invoicePeriodInput")?.value)}</strong>
      </div>

      <div class="preview-row">
        <span>Due Date</span>
        <strong>${escapeHtml(formatDate(new Date(`${$("invoiceDueDateInput")?.value}T00:00:00`)))}</strong>
      </div>

      <div class="preview-row">
        <span>Payment Mode</span>
        <strong>${escapeHtml($("invoicePaymentModeInput")?.value)}</strong>
      </div>
    </div>

    <div class="detail-section">
      <h4>Billing Items</h4>

      ${totals.lines.map((line) => `
        <div class="preview-row">
          <span>${escapeHtml(line.name)}</span>
          <strong>${escapeHtml(money(line.total))}</strong>
        </div>
      `).join("")}
    </div>

    <div class="detail-section">
      <h4>Summary</h4>

      <div class="preview-row">
        <span>Subtotal</span>
        <strong>${escapeHtml(money(totals.subtotal))}</strong>
      </div>

      <div class="preview-row">
        <span>Taxes</span>
        <strong>${escapeHtml(money(totals.taxAmount))}</strong>
      </div>

      <div class="preview-row">
        <span>Credits</span>
        <strong>-${escapeHtml(money(totals.adjustmentAmount))}</strong>
      </div>

      <div class="preview-row total">
        <span>Grand Total</span>
        <strong>${escapeHtml(money(totals.total))}</strong>
      </div>

      <div class="preview-row">
        <span>Amount Received</span>
        <strong>${escapeHtml(money(totals.amountReceived))}</strong>
      </div>

      <div class="preview-row total">
        <span>Balance Due</span>
        <strong>${escapeHtml(money(totals.balance))}</strong>
      </div>
    </div>
  `;

  openModal("invoicePreviewModal");
}

async function saveInvoice() {
  if (!validateInvoice() || state.saving) return;

  state.saving = true;

  const saveButton = $("saveInvoiceBtn");

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const residentId = $("invoiceResidentInput")?.value || "";
    const propertyId = $("invoicePropertyInput")?.value || "";
    const billingEntityId = $("invoiceEntityInput")?.value || "";

    const resident = state.residents.find((item) => item.id === residentId);
    const property = state.properties.find((item) => item.id === propertyId);
    const entity = activeEntities().find((item) => item.id === billingEntityId);

    if (!resident || !property || !entity) {
      toast("Selected resident, property or billing entity not found.", true);
      return;
    }

    const totals = invoiceTotals();

    const invoiceRef = doc(collection(db, COLLECTIONS.invoices));
    const invoiceNo = `INV-${invoiceRef.id.slice(0, 6).toUpperCase()}`;

    const dueDateValue = $("invoiceDueDateInput")?.value || dateInput(new Date());
    const dueDate = new Date(`${dueDateValue}T00:00:00`);

    const paymentStatus = paymentStatusFromValues(
      totals.total,
      totals.amountReceived,
      dueDate
    );

    const mainCategory = totals.billLines[0]?.category || "Custom";

    const batch = writeBatch(db);

    batch.set(invoiceRef, {
      invoiceNo,
      residentId: resident.id,
      residentName: residentName(resident),
      phone: firstText(resident, ["phone", "mobile"]),
      email: firstText(resident, ["email"]),
      propertyId: property.id,
      propertyName: propertyName(property),
      billingEntityId: entity.id,
      billingEntityName: firstText(entity, ["name", "vendorName"]) || "Vendor",
      billingEntityType: firstText(entity, ["type", "entityType"]) || "Custom",
      vendorName: firstText(entity, ["name", "vendorName"]) || "Vendor",
      vendorPan: firstText(entity, ["pan"]),
      vendorGstin: firstText(entity, ["gstin"]),
      vendorBankName: firstText(entity, ["bankName"]),
      vendorAccountNumber: firstText(entity, ["accountNumber"]),
      vendorIfsc: firstText(entity, ["ifsc"]),
      vendorAddress: firstText(entity, ["address"]),
      billingPeriod: text($("invoicePeriodInput")?.value),
      dueDate: Timestamp.fromDate(dueDate),
      category: mainCategory,
      invoiceType: mainCategory.toLowerCase(),
      lineItems: totals.lines,
      grossSubtotal: totals.grossSubtotal,
      grossTotal: totals.grossTotal,
      adjustmentAmount: totals.adjustmentAmount,
      appliedAdjustmentIds: totals.appliedAdjustments.map((item) => item.adjustment.id),
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.total,
      amountReceived: totals.amountReceived,
      paidAmount: totals.amountReceived,
      balanceAmount: totals.balance,
      pendingAmount: totals.balance,
      paymentStatus,
      paymentMode: $("invoicePaymentModeInput")?.value || "UPI",
      notes: text($("invoiceNotesInput")?.value),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (totals.appliedAdjustments.length) {
      totals.appliedAdjustments.forEach((application) => {
        const adjustment = application.adjustment;
        const adjustmentAmountValue = firstNumber(adjustment, ["amount", "remainingAmount", "creditAmount"]);
        const remainingAmount = Math.max(adjustmentAmountValue - application.appliedAmount, 0);
        const fullyAdjusted = remainingAmount <= 0;

        batch.set(doc(db, COLLECTIONS.billingAdjustments, adjustment.id), {
          status: fullyAdjusted ? "Adjusted" : "Partially Adjusted",
          billingStatus: fullyAdjusted ? "Adjusted" : "Partially Adjusted",
          invoiceId: invoiceRef.id,
          invoiceNo,
          lastAdjustedAmount: application.appliedAmount,
          adjustedAmount: increment(application.appliedAmount),
          remainingAmount,
          adjustedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      batch.set(doc(db, COLLECTIONS.residents, resident.id), {
        nextBillCredit: increment(-totals.adjustmentAmount),
        referralRewardBalance: increment(-totals.adjustmentAmount),
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, COLLECTIONS.users, resident.id), {
        nextBillCredit: increment(-totals.adjustmentAmount),
        referralRewardBalance: increment(-totals.adjustmentAmount),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    if (totals.amountReceived > 0) {
      const transactionRef = doc(collection(db, COLLECTIONS.transactions));

      batch.set(transactionRef, {
        transactionId: transactionRef.id,
        invoiceId: invoiceRef.id,
        invoiceNo,
        residentId: resident.id,
        residentName: residentName(resident),
        propertyId: property.id,
        propertyName: propertyName(property),
        billingEntityId: entity.id,
        billingEntityName: firstText(entity, ["name", "vendorName"]) || "Vendor",
        billingEntityType: firstText(entity, ["type", "entityType"]) || "Custom",
        amount: totals.amountReceived,
        paymentMode: $("invoicePaymentModeInput")?.value || "UPI",
        paymentStatus,
        type: "invoice_payment",
        category: mainCategory,
        lineItems: totals.lines,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();

    toast("Invoice saved successfully.");

    closeModal("invoicePreviewModal");
    closeModal("invoiceModal");

    resetInvoiceForm();
  } catch (error) {
    console.error("Invoice save failed:", error);
    toast(`Failed to save invoice: ${error.message}`, true);
  } finally {
    state.saving = false;

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = `<i class="fa-solid fa-check"></i> Save Invoice`;
    }
  }
}

/* INVOICE DETAIL */

function openInvoiceDetail(invoice) {
  state.currentDetailInvoice = invoice;

  setText("detailInvoiceTitle", invoice.invoiceNo);

  const content = $("invoiceDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="detail-section">
      <h4>Invoice Summary</h4>

      <div class="detail-row"><span>Resident</span><strong>${escapeHtml(invoice.residentName)}</strong></div>
      <div class="detail-row"><span>Phone</span><strong>${escapeHtml(invoice.phone || "-")}</strong></div>
      <div class="detail-row"><span>Property</span><strong>${escapeHtml(invoice.propertyName)}</strong></div>
      <div class="detail-row"><span>Billing Entity</span><strong>${escapeHtml(invoice.billingEntityName || "-")}</strong></div>

      ${invoice.vendorPan ? `<div class="detail-row"><span>PAN</span><strong>${escapeHtml(invoice.vendorPan)}</strong></div>` : ""}
      ${invoice.vendorGstin ? `<div class="detail-row"><span>GSTIN</span><strong>${escapeHtml(invoice.vendorGstin)}</strong></div>` : ""}

      <div class="detail-row"><span>Billing Period</span><strong>${escapeHtml(invoice.billingPeriod)}</strong></div>
      <div class="detail-row"><span>Due Date</span><strong>${escapeHtml(formatDate(invoice.dueDate))}</strong></div>
    </div>

    <div class="detail-section">
      <h4>Payment Fields</h4>

      ${
        invoice.lineItems.length
          ? invoice.lineItems.map((line) => `
            <div class="detail-row">
              <span>${escapeHtml(line.name)} · ${escapeHtml(line.category)} · Tax ${escapeHtml(line.taxRate)}%</span>
              <strong>${escapeHtml(money(line.total))}</strong>
            </div>
          `).join("")
          : `<div class="detail-row"><span>No line items</span><strong>-</strong></div>`
      }
    </div>

    <div class="detail-section">
      <h4>Total</h4>

      ${invoice.adjustmentAmount > 0 ? `<div class="detail-row"><span>Before Credits</span><strong>${escapeHtml(money(invoice.grossTotal))}</strong></div>` : ""}
      ${invoice.adjustmentAmount > 0 ? `<div class="detail-row"><span>Referral / Billing Credit</span><strong>-${escapeHtml(money(invoice.adjustmentAmount))}</strong></div>` : ""}

      <div class="detail-row"><span>Subtotal</span><strong>${escapeHtml(money(invoice.subtotal || invoice.totalAmount))}</strong></div>
      <div class="detail-row"><span>Taxes</span><strong>${escapeHtml(money(invoice.taxAmount))}</strong></div>
      <div class="detail-row total"><span>Grand Total</span><strong>${escapeHtml(money(invoice.totalAmount))}</strong></div>
      <div class="detail-row"><span>Amount Paid</span><strong>${escapeHtml(money(invoice.amountReceived))}</strong></div>
      <div class="detail-row total"><span>Balance Due</span><strong>${escapeHtml(money(invoice.balanceAmount))}</strong></div>
    </div>

    <div>
      <span class="tiny-chip" style="color:${statusColor(invoice.paymentStatus)};background:${soft(statusColor(invoice.paymentStatus))}">
        ${escapeHtml(invoice.paymentStatus)}
      </span>

      <span class="tiny-chip" style="color:${COLORS.gold};background:${soft(COLORS.gold)}">
        ${escapeHtml(invoice.paymentMode)}
      </span>

      <span class="tiny-chip" style="color:${categoryColor(invoice.category)};background:${soft(categoryColor(invoice.category))}">
        ${escapeHtml(invoice.category)}
      </span>
    </div>
  `;

  openModal("invoiceDetailModal");
}

/* VENDORS */

function renderVendorList() {
  const box = $("vendorList");
  if (!box) return;

  const vendors = activeEntities().sort((a, b) => {
    const typeCompare = firstText(a, ["type", "entityType"]).localeCompare(firstText(b, ["type", "entityType"]));

    if (typeCompare !== 0) return typeCompare;

    return firstText(a, ["name", "vendorName"]).localeCompare(firstText(b, ["name", "vendorName"]));
  });

  if (!vendors.length) {
    box.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-store"></i>
        <strong>No vendors added yet</strong>
        <span>Add Lively Legacy for rent and your food vendor for food invoices.</span>
      </div>
    `;
    return;
  }

  box.innerHTML = vendors.map((vendor) => {
    const name = firstText(vendor, ["name", "vendorName"]) || "Vendor";
    const type = normalizeCategory(firstText(vendor, ["type", "entityType"]) || "Custom");
    const prefix = firstText(vendor, ["invoicePrefix"]) || type.toUpperCase();
    const pan = firstText(vendor, ["pan"]);
    const color = categoryColor(type);

    return `
      <div class="setting-row">
        <span class="sheet-icon" style="color:${color};background:${soft(color)}">
          <i class="fa-solid fa-store"></i>
        </span>

        <div>
          <strong>${escapeHtml(name)}</strong>
          <small>${escapeHtml(type)} • Prefix ${escapeHtml(prefix)}${pan ? ` • PAN ${escapeHtml(pan)}` : ""}</small>
        </div>

        <div class="setting-actions">
          <button type="button" data-edit-vendor="${escapeHtml(vendor.id)}">
            <i class="fa-solid fa-pen"></i>
          </button>

          <button type="button" class="delete" data-delete-vendor="${escapeHtml(vendor.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  box.querySelectorAll("[data-edit-vendor]").forEach((button) => {
    button.addEventListener("click", () => {
      const vendor = vendors.find((item) => item.id === button.dataset.editVendor);
      openVendorForm(vendor);
    });
  });

  box.querySelectorAll("[data-delete-vendor]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteVendor(button.dataset.deleteVendor);
    });
  });
}

function openVendorForm(vendor = null) {
  $("vendorForm").hidden = false;
  $("vendorForm")?.reset();

  setText("vendorFormTitle", vendor ? "Edit Vendor" : "Add Vendor");

  $("vendorEditId").value = vendor?.id || "";
  $("vendorNameInput").value = vendor ? firstText(vendor, ["name", "vendorName"]) : "";
  $("vendorTypeInput").value = vendor ? normalizeCategory(firstText(vendor, ["type", "entityType"])) : "Food";
  $("vendorPrefixInput").value = vendor ? firstText(vendor, ["invoicePrefix"]) : "FOOD";
  $("vendorPanInput").value = vendor ? firstText(vendor, ["pan"]) : "";
  $("vendorGstinInput").value = vendor ? firstText(vendor, ["gstin"]) : "";
  $("vendorBankInput").value = vendor ? firstText(vendor, ["bankName"]) : "";
  $("vendorAccountInput").value = vendor ? firstText(vendor, ["accountNumber"]) : "";
  $("vendorIfscInput").value = vendor ? firstText(vendor, ["ifsc"]) : "";
  $("vendorAddressInput").value = vendor ? firstText(vendor, ["address"]) : "";
}

function closeVendorForm() {
  $("vendorForm").hidden = true;
  $("vendorForm")?.reset();
}

async function saveVendor(event) {
  event.preventDefault();

  const name = text($("vendorNameInput")?.value);
  const type = normalizeCategory($("vendorTypeInput")?.value);
  const prefix = text($("vendorPrefixInput")?.value).toUpperCase();

  if (!name) {
    toast("Enter vendor/billing entity name.", true);
    return;
  }

  if (!prefix) {
    toast("Enter invoice prefix, for example FOOD or RENT.", true);
    return;
  }

  try {
    const editId = text($("vendorEditId")?.value);
    const ref = editId
      ? doc(db, COLLECTIONS.billingEntities, editId)
      : doc(collection(db, COLLECTIONS.billingEntities));

    await setDoc(ref, {
      name,
      vendorName: name,
      type,
      entityType: type,
      invoicePrefix: prefix,
      pan: text($("vendorPanInput")?.value),
      gstin: text($("vendorGstinInput")?.value),
      bankName: text($("vendorBankInput")?.value),
      accountNumber: text($("vendorAccountInput")?.value),
      ifsc: text($("vendorIfscInput")?.value).toUpperCase(),
      address: text($("vendorAddressInput")?.value),
      isActive: true,
      updatedAt: serverTimestamp(),
      ...(editId ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });

    toast("Vendor saved.");
    closeVendorForm();
  } catch (error) {
    console.error(error);
    toast(`Failed to save vendor: ${error.message}`, true);
  }
}

async function deleteVendor(id) {
  if (!id) return;

  try {
    await setDoc(doc(db, COLLECTIONS.billingEntities, id), {
      isActive: false,
      updatedAt: serverTimestamp()
    }, { merge: true });

    toast("Vendor removed.");
  } catch (error) {
    toast(`Failed to delete vendor: ${error.message}`, true);
  }
}

async function createRentVendor() {
  try {
    const ref = doc(collection(db, COLLECTIONS.billingEntities));

    await setDoc(ref, {
      name: "Lively Legacy",
      vendorName: "Lively Legacy",
      type: "Rent",
      entityType: "Rent",
      invoicePrefix: "RENT",
      pan: "",
      gstin: "",
      bankName: "",
      accountNumber: "",
      ifsc: "",
      address: "",
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    toast("Rental billing entity created.");
  } catch (error) {
    toast(`Failed to create rental entity: ${error.message}`, true);
  }
}

/* BILLING FIELDS */

function renderFieldList() {
  const box = $("fieldList");
  if (!box) return;

  const fields = activeFields().sort((a, b) => {
    return firstText(a, ["name", "fieldName"]).localeCompare(firstText(b, ["name", "fieldName"]));
  });

  if (!fields.length) {
    box.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-sliders"></i>
        <strong>No billing fields yet</strong>
        <span>Create default fields or add custom billing fields.</span>
      </div>
    `;
    return;
  }

  box.innerHTML = fields.map((field) => {
    const name = firstText(field, ["name", "fieldName"]) || "Field";
    const category = normalizeCategory(firstText(field, ["category"]) || "Custom");
    const defaultAmount = firstNumber(field, ["defaultAmount", "amount"]);
    const taxRate = firstNumber(field, ["taxRate"]);
    const taxMode = normalizeTaxMode(firstText(field, ["taxMode"]));
    const color = categoryColor(category);

    return `
      <div class="setting-row">
        <span class="sheet-icon" style="color:${color};background:${soft(color)}">
          <i class="fa-solid fa-receipt"></i>
        </span>

        <div>
          <strong>${escapeHtml(name)}</strong>
          <small>${escapeHtml(category)} • Default ${escapeHtml(money(defaultAmount))} • Tax ${taxRate}% ${taxMode === "included" ? "Included" : "Not Included"}</small>
        </div>

        <div class="setting-actions">
          <button type="button" data-edit-field="${escapeHtml(field.id)}">
            <i class="fa-solid fa-pen"></i>
          </button>

          <button type="button" class="delete" data-delete-field="${escapeHtml(field.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  box.querySelectorAll("[data-edit-field]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = fields.find((item) => item.id === button.dataset.editField);
      openFieldForm(field);
    });
  });

  box.querySelectorAll("[data-delete-field]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteField(button.dataset.deleteField);
    });
  });
}

function openFieldForm(field = null) {
  $("fieldForm").hidden = false;
  $("fieldForm")?.reset();

  setText("fieldFormTitle", field ? "Edit Billing Field" : "Add Billing Field");

  $("fieldEditId").value = field?.id || "";
  $("fieldNameInput").value = field ? firstText(field, ["name", "fieldName"]) : "";
  $("fieldCategoryInput").value = field ? normalizeCategory(firstText(field, ["category"])) : "Rent";
  $("fieldDefaultAmountInput").value = field ? firstNumber(field, ["defaultAmount", "amount"]) : 0;
  $("fieldTaxRateInput").value = field ? firstNumber(field, ["taxRate"]) : 0;
  $("fieldTaxModeInput").value = field ? normalizeTaxMode(firstText(field, ["taxMode"])) : "excluded";
}

function closeFieldForm() {
  $("fieldForm").hidden = true;
  $("fieldForm")?.reset();
}

async function saveField(event) {
  event.preventDefault();

  const name = text($("fieldNameInput")?.value);
  const category = normalizeCategory($("fieldCategoryInput")?.value);

  if (!name) {
    toast("Enter field name.", true);
    return;
  }

  if (!category) {
    toast("Enter category.", true);
    return;
  }

  try {
    const editId = text($("fieldEditId")?.value);
    const ref = editId
      ? doc(db, COLLECTIONS.billingFields, editId)
      : doc(collection(db, COLLECTIONS.billingFields));

    await setDoc(ref, {
      name,
      category,
      defaultAmount: amount($("fieldDefaultAmountInput")?.value),
      taxRate: amount($("fieldTaxRateInput")?.value),
      taxMode: normalizeTaxMode($("fieldTaxModeInput")?.value),
      isActive: true,
      updatedAt: serverTimestamp(),
      ...(editId ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });

    toast("Billing field saved.");
    closeFieldForm();
  } catch (error) {
    toast(`Failed to save field: ${error.message}`, true);
  }
}

async function deleteField(id) {
  if (!id) return;

  try {
    await setDoc(doc(db, COLLECTIONS.billingFields, id), {
      isActive: false,
      updatedAt: serverTimestamp()
    }, { merge: true });

    toast("Billing field removed.");
  } catch (error) {
    toast(`Failed to delete field: ${error.message}`, true);
  }
}

async function createDefaultFields() {
  try {
    const batch = writeBatch(db);

    [
      { name: "Rent", category: "Rent" },
      { name: "Food", category: "Food" },
      { name: "Deposit", category: "Deposit" },
      { name: "Maintenance", category: "Maintenance" }
    ].forEach((item) => {
      const ref = doc(collection(db, COLLECTIONS.billingFields));

      batch.set(ref, {
        name: item.name,
        category: item.category,
        defaultAmount: 0,
        taxRate: 0,
        taxMode: "excluded",
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });

    await batch.commit();

    toast("Default billing fields created.");
  } catch (error) {
    toast(`Failed to create default fields: ${error.message}`, true);
  }
}

/* AUTH + FIREBASE */

function setupAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      console.warn("Revenue page: no logged in user");
      window.location.href = "../index.html";
      return;
    }

    console.log("Revenue auth ready:", user.uid, user.email);

    const name = user.displayName || "Admin";
    const email = user.email || "admin@email.com";
    const short = initials(name || email);

    setText("adminName", name);
    setText("dropdownAdminName", name);
    setText("dropdownAdminEmail", email);
    setText("adminAvatar", short);
    setText("adminAvatarSmall", short);

    if (!firebaseStarted) {
      firebaseStarted = true;
      console.log("Starting revenue Firebase listeners after auth ready");
      setupFirebase();
    }
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.clear();
    window.location.href = "../index.html";
  });
}

function listenCollection(stateKey, collectionName) {
  console.log("Listening to:", collectionName);

  const unsubscribe = onSnapshot(
    collection(db, collectionName),
    (snapshot) => {
      state[stateKey] = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data()
      }));

      console.log(`${collectionName} loaded:`, state[stateKey].length);

      renderPage();
    },
    (error) => {
      console.error(`${collectionName} fetch failed:`, error);

      state[stateKey] = [];
      renderPage();

      toast(`${collectionName} fetch failed: ${error.message}`, true);
    }
  );

  state.unsubscribers.push(unsubscribe);
}

function setupFirebase() {
  if (state.unsubscribers.length > 0) {
    console.log("Revenue Firebase listeners already active");
    return;
  }

  listenCollection("invoices", COLLECTIONS.invoices);
  listenCollection("transactions", COLLECTIONS.transactions);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("billingFields", COLLECTIONS.billingFields);
  listenCollection("billingEntities", COLLECTIONS.billingEntities);
  listenCollection("billingAdjustments", COLLECTIONS.billingAdjustments);
}

/* LAYOUT + EVENTS */

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

  document.addEventListener("click", (event) => {
    const dropdownButton = event.target.closest(".nav-dropdown-btn");
    const dropdownBox = event.target.closest(".nav-dropdown");

    if (dropdownButton && dropdownBox) {
      event.preventDefault();
      event.stopPropagation();

      const alreadyOpen = dropdownBox.classList.contains("active");

      document.querySelectorAll(".nav-dropdown.active").forEach((item) => {
        item.classList.remove("active");
      });

      if (!alreadyOpen) dropdownBox.classList.add("active");

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
      closeModal("invoiceModal");
      closeModal("billingItemModal");
      closeModal("invoicePreviewModal");
      closeModal("invoiceDetailModal");
      closeModal("vendorModal");
      closeModal("fieldModal");

      profileDropdown?.classList.remove("show");
    }
  });
}

function clearFilters() {
  if ($("globalSearchInput")) $("globalSearchInput").value = "";
  if ($("invoiceSearchInput")) $("invoiceSearchInput").value = "";
  if ($("propertyFilter")) $("propertyFilter").value = "All Properties";
  if ($("categoryFilter")) $("categoryFilter").value = "All Categories";
  if ($("statusFilter")) $("statusFilter").value = "All Statuses";
  if ($("modeFilter")) $("modeFilter").value = "All Modes";
  if ($("periodFilter")) $("periodFilter").value = "This Month";
  if ($("sortFilter")) $("sortFilter").value = "Recently Added";

  state.currentPage = 1;
  renderInvoiceList();
}

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    toast("Revenue page refreshed.");
  });

  $("openInvoiceBtn")?.addEventListener("click", () => {
    resetInvoiceForm();
    openModal("invoiceModal");
  });

  $("closeInvoiceModal")?.addEventListener("click", () => closeModal("invoiceModal"));
  $("cancelInvoiceBtn")?.addEventListener("click", () => closeModal("invoiceModal"));
  $("reloadInvoiceOptionsBtn")?.addEventListener("click", renderInvoiceFormOptions);

  $("addBillingItemBtn")?.addEventListener("click", openBillingItemPicker);
  $("closeBillingItemModal")?.addEventListener("click", () => closeModal("billingItemModal"));
  $("addCustomLineBtn")?.addEventListener("click", addCustomInvoiceLine);

  $("previewInvoiceBtn")?.addEventListener("click", previewInvoice);
  $("closePreviewModal")?.addEventListener("click", () => closeModal("invoicePreviewModal"));
  $("cancelPreviewBtn")?.addEventListener("click", () => closeModal("invoicePreviewModal"));
  $("saveInvoiceBtn")?.addEventListener("click", saveInvoice);

  $("closeDetailModal")?.addEventListener("click", () => closeModal("invoiceDetailModal"));

  $("openVendorBtn")?.addEventListener("click", () => {
    renderVendorList();
    openModal("vendorModal");
  });

  $("closeVendorModal")?.addEventListener("click", () => {
    closeVendorForm();
    closeModal("vendorModal");
  });

  $("newVendorBtn")?.addEventListener("click", () => openVendorForm());
  $("cancelVendorFormBtn")?.addEventListener("click", closeVendorForm);
  $("vendorForm")?.addEventListener("submit", saveVendor);
  $("createRentVendorBtn")?.addEventListener("click", createRentVendor);

  $("vendorTypeInput")?.addEventListener("change", () => {
    const prefix = text($("vendorPrefixInput")?.value);

    if (!prefix || ["FOOD", "RENT"].includes(prefix.toUpperCase())) {
      $("vendorPrefixInput").value = text($("vendorTypeInput")?.value).toUpperCase();
    }
  });

  $("openFieldBtn")?.addEventListener("click", () => {
    renderFieldList();
    openModal("fieldModal");
  });

  $("closeFieldModal")?.addEventListener("click", () => {
    closeFieldForm();
    closeModal("fieldModal");
  });

  $("newFieldBtn")?.addEventListener("click", () => openFieldForm());
  $("cancelFieldFormBtn")?.addEventListener("click", closeFieldForm);
  $("fieldForm")?.addEventListener("submit", saveField);
  $("createDefaultFieldsBtn")?.addEventListener("click", createDefaultFields);

  $("invoiceResidentInput")?.addEventListener("change", () => {
    const resident = state.residents.find((item) => item.id === $("invoiceResidentInput").value);

    if (resident) {
      const propertyId = firstText(resident, ["propertyId", "currentPropertyId"]);

      if (propertyId && $("invoicePropertyInput")) {
        $("invoicePropertyInput").value = propertyId;
      }
    }

    renderAdjustmentBox();
    updateInvoiceSummary();
  });

  $("invoicePeriodInput")?.addEventListener("input", () => {
    renderAdjustmentBox();
    updateInvoiceSummary();
  });

  $("invoiceAmountReceivedInput")?.addEventListener("input", updateInvoiceSummary);

  ["globalSearchInput", "invoiceSearchInput"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      state.currentPage = 1;

      if (id === "globalSearchInput" && $("invoiceSearchInput")) {
        $("invoiceSearchInput").value = $("globalSearchInput").value;
      }

      renderInvoiceList();
    });
  });

  [
    "propertyFilter",
    "categoryFilter",
    "statusFilter",
    "modeFilter",
    "periodFilter",
    "sortFilter"
  ].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      state.currentPage = 1;
      renderInvoiceList();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", clearFilters);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("revenue.js DOM ready");

  setupAuth();
  setupLayoutControls();
  setupEvents();
  renderPage();
});