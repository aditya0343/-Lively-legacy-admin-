import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Timestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

console.log("bookings.js loaded");

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  customers: "customers",
  residents: "residents",
  properties: "properties",
  rooms: "rooms",
  beds: "beds",
  bookings: "bookings",
  leads: "leads",
  invoices: "invoices",
  transactions: "transactions",
  activityLogs: "activity_logs",
  foodPlans: "food_plans"
};

const state = {
  customers: [],
  residents: [],
  properties: [],
  rooms: [],
  beds: [],
  bookings: [],
  leads: [],
  invoices: [],
  transactions: [],
  foodPlans: [],
  currentPage: 1,
  rowsPerPage: 10,
  kycFiles: [],
  saving: false
};

function safeText(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return safeText(value).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (value !== undefined && value !== null && safeText(value) !== "") {
      return value;
    }
  }

  return "";
}

function getText(data, keys) {
  const value = getValue(data, keys);

  if (value?.toDate || typeof value === "object") return "";

  return safeText(value);
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInputValue(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function timestampFromInput(value) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(numberValue(value));
}

function shortMoney(value) {
  const n = numberValue(value);

  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}K`;

  return money(n);
}

function cleanLabel(value) {
  const raw = safeText(value);

  if (!raw) return "Unknown";

  return raw
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function toast(message, isError = false) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

function initials(nameOrEmail) {
  const text = safeText(nameOrEmail || "Admin");

  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function phoneDigits(value) {
  const digits = safeText(value).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function phoneWithCode(value) {
  const digits = phoneDigits(value);
  return digits ? `+91${digits}` : "";
}

function propertyName(property) {
  return getText(property, ["propertyName", "name", "title", "buildingName", "listingName"]) ||
    property?.id ||
    "Property";
}

function roomNo(room) {
  return (
    getText(room, ["roomNo", "roomNumber", "roomName", "name", "title"]) ||
    room?.id ||
    ""
  ).replace(/^Room\s+/i, "");
}

function bedNo(bed) {
  return (
    getText(bed, ["bedNo", "bedNumber", "bedName", "name", "title"]) ||
    bed?.id ||
    ""
  ).replace(/^Bed\s+/i, "");
}

function propertyAdvanceRent(property) {
  return numberValue(getValue(property, [
    "advanceRoomRent",
    "advance_room_rent",
    "advanceRent",
    "advanceRentAmount",
    "advance_rent",
    "advanceAmount",
    "advance_amount",
    "advancePayment",
    "rentAdvance",
    "upfrontRent",
    "oneMonthAdvanceRent"
  ]));
}

function roomRent(room) {
  return numberValue(getValue(room, [
    "monthlyRent",
    "rentAmount",
    "roomRent",
    "rent",
    "monthlyAmount",
    "roomPrice",
    "price",
    "amount"
  ]));
}

function bedRent(bed) {
  return numberValue(getValue(bed, [
    "monthlyRent",
    "rentAmount",
    "bedRent",
    "bedMonthlyRent",
    "rent",
    "bedPrice",
    "price",
    "amount"
  ]));
}

function roomTypeBucket(value, capacity = 0) {
  const text = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (text.includes("triple") || text === "3" || capacity >= 3) return "Triple";
  if (text.includes("double") || text === "2" || capacity === 2) return "Double";
  if (text.includes("single") || text === "1" || capacity === 1) return "Single";

  return "Single";
}

function coolingType(value) {
  const text = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (text === "ac" || text === "a c") return "AC";
  if (text.includes("non")) return "Non AC";
  if (text.includes("cooler")) return "Cooler";

  return cleanLabel(value || "Non AC");
}

function isAvailableStatus(status) {
  const text = normalize(status);
  return ["", "available", "vacant", "open", "active"].includes(text);
}

function isActiveBookingStatus(status) {
  const text = normalize(status);

  return [
    "confirmed",
    "booked",
    "active",
    "checked_in",
    "checked-in",
    "checked in",
    "ongoing"
  ].includes(text);
}

function isCancelledStatus(status) {
  const text = normalize(status);
  return ["cancelled", "canceled", "lost", "closed", "rejected", "refunded"].includes(text);
}

function isPaymentDue(status) {
  const text = normalize(status);

  return text.includes("due") ||
    text.includes("pending") ||
    text.includes("unpaid") ||
    text.includes("partial") ||
    text.includes("not paid");
}

function recordProperty(record) {
  const id = getText(record, [
    "propertyId",
    "propertyDocId",
    "propertyCode",
    "property_id",
    "listingId",
    "currentPropertyId"
  ]);

  const name = getText(record, ["propertyName", "property", "currentPropertyName"]);

  return state.properties.find((property) => property.id === id) ||
    state.properties.find((property) => propertyName(property) === name) ||
    null;
}

function getRoomById(roomId) {
  return state.rooms.find((room) => room.id === roomId) || null;
}

function getBedById(bedId) {
  return state.beds.find((bed) => bed.id === bedId) || null;
}

function activeIds() {
  const roomIds = new Set();
  const bedIds = new Set();

  state.bookings.forEach((booking) => {
    const status = getText(booking, ["status", "bookingStatus"]);

    if (!isActiveBookingStatus(status)) return;

    const roomId = getText(booking, ["roomId", "room_id", "currentRoomId"]);
    const bedId = getText(booking, ["bedId", "bed_id", "currentBedId"]);

    if (roomId) roomIds.add(roomId);
    if (bedId) bedIds.add(bedId);
  });

  return { roomIds, bedIds };
}

function availableBeds(roomId) {
  const { bedIds } = activeIds();

  return state.beds.filter((bed) => {
    const bedRoomId = getText(bed, ["roomId", "room_id"]);
    const status = getText(bed, ["status", "bedStatus"]) || "available";
    const occupied = bed.isOccupied === true;

    return bedRoomId === roomId &&
      isAvailableStatus(status) &&
      !occupied &&
      !bedIds.has(bed.id);
  });
}

function availableRooms(propertyId, wantedRoomType = "All Room Types") {
  const { roomIds } = activeIds();

  return state.rooms.filter((room) => {
    const roomPropertyId = getText(room, ["propertyId", "property_id"]);
    const status = getText(room, ["status", "roomStatus"]) || "available";

    const capacity = numberValue(getValue(room, [
      "sharingCapacity",
      "capacity",
      "totalBeds",
      "bedCount"
    ]));

    const type = roomTypeBucket(getText(room, ["roomType", "sharingType", "type"]), capacity);

    const roomBeds = state.beds.filter((bed) => {
      return getText(bed, ["roomId", "room_id"]) === room.id;
    });

    const hasBeds = roomBeds.length > 0;
    const availableBedCount = availableBeds(room.id).length;

    const propertyMatch = roomPropertyId === propertyId;
    const typeMatch = wantedRoomType === "All Room Types" || type === wantedRoomType;
    const statusMatch = isAvailableStatus(status) && !roomIds.has(room.id);

    if (!hasBeds) return propertyMatch && typeMatch && statusMatch;

    return propertyMatch && typeMatch && statusMatch && availableBedCount > 0;
  });
}

function bookingAmount(booking) {
  return numberValue(getValue(booking, [
    "amount",
    "totalAmount",
    "bookingAmount",
    "price",
    "paidAmount",
    "amountReceived",
    "rentAmount"
  ]));
}

function dueAmount(booking) {
  return numberValue(getValue(booking, [
    "outstandingAmount",
    "dueAmount",
    "pendingAmount",
    "balanceAmount"
  ]));
}

function getBookingRecord(booking) {
  const property = recordProperty(booking);
  const roomId = getText(booking, ["roomId", "room_id", "currentRoomId"]);
  const bedId = getText(booking, ["bedId", "bed_id", "currentBedId"]);
  const room = getRoomById(roomId);
  const bed = getBedById(bedId);
  const due = dueAmount(booking);

  return {
    id: booking.id,
    typeLabel: "Booking",
    isLead: false,
    referenceNo: getText(booking, ["bookingNo", "bookingId", "id"]) || booking.id,
    name: getText(booking, [
      "residentName",
      "guestName",
      "tenantName",
      "customerName",
      "name",
      "fullName"
    ]) || "Guest",
    phone: getText(booking, ["phone", "mobile", "contact", "phoneNumber"]),
    email: getText(booking, ["email", "emailAddress"]),
    propertyId: getText(booking, ["propertyId", "property_id", "listingId", "currentPropertyId"]),
    propertyName: getText(booking, ["propertyName", "property", "currentPropertyName"]) ||
      (property ? propertyName(property) : "No Property"),
    roomNo: getText(booking, ["roomNo", "roomNumber", "roomName", "currentRoomNo"]) ||
      (room ? roomNo(room) : ""),
    bedNo: getText(booking, ["bedNo", "bedNumber", "bedName", "currentBedNo"]) ||
      (bed ? bedNo(bed) : ""),
    roomType: roomTypeBucket(
      getText(booking, ["roomType", "sharingType"]) ||
      (room ? getText(room, ["roomType", "sharingType", "type"]) : "")
    ),
    stayType: cleanLabel(getText(booking, ["stayType", "rentPlan"]) || "Stay"),
    source: getText(booking, ["source", "leadSource", "bookingSource"]) || "Manual",
    stage: cleanLabel(getText(booking, ["status", "bookingStatus"]) || "confirmed"),
    paymentStatus: cleanLabel(getText(booking, ["paymentStatus", "payment_status"]) || (due > 0 ? "due" : "paid")),
    amount: bookingAmount(booking),
    dueAmount: due,
    followUpDate: null,
    createdAt: toDate(booking.createdAt || booking.created_at || booking.bookingDate),
    raw: booking
  };
}

function getLeadRecord(lead) {
  const property = recordProperty(lead);

  return {
    id: lead.id,
    typeLabel: "Lead",
    isLead: true,
    referenceNo: getText(lead, ["leadNo", "leadId", "id"]) || lead.id,
    name: getText(lead, ["leadName", "name", "fullName"]) || "Lead",
    phone: getText(lead, ["phone", "mobile", "contact"]),
    email: getText(lead, ["email", "emailAddress"]),
    propertyId: getText(lead, ["propertyId", "property_id", "listingId"]),
    propertyName: getText(lead, ["propertyName", "property"]) ||
      (property ? propertyName(property) : "No Property"),
    roomNo: "",
    bedNo: "",
    roomType: roomTypeBucket(getText(lead, ["roomType", "sharingType"])),
    stayType: cleanLabel(getText(lead, ["stayType"]) || "Lead"),
    source: getText(lead, ["source", "leadSource"]) || "Unknown",
    stage: cleanLabel(getText(lead, ["status", "leadStage", "stage"]) || "new_lead"),
    paymentStatus: "Not Paid",
    amount: numberValue(getValue(lead, ["budget", "expectedBudget"])),
    dueAmount: 0,
    followUpDate: toDate(lead.followUpDate || lead.follow_up_date),
    createdAt: toDate(lead.createdAt || lead.created_at),
    raw: lead
  };
}

function records() {
  return [
    ...state.bookings.map(getBookingRecord),
    ...state.leads.map(getLeadRecord)
  ];
}

function isThisMonth(value) {
  const date = toDate(value);
  if (!date) return false;

  const now = new Date();

  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function isFollowUpDue(record) {
  if (!record.isLead || !record.followUpDate) return false;

  const status = normalize(record.stage);

  if (["converted", "lost", "closed"].includes(status)) return false;

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return record.followUpDate <= todayEnd;
}

function calculate() {
  const all = records();

  const totalBookings = state.bookings.length;

  const confirmedCheckIns = state.bookings.filter((booking) => {
    return isActiveBookingStatus(getText(booking, ["status", "bookingStatus"]));
  }).length;

  const bookingValueTotal = state.bookings.reduce((sum, booking) => {
    const status = getText(booking, ["status", "bookingStatus"]);
    if (isCancelledStatus(status)) return sum;
    return sum + bookingAmount(booking);
  }, 0);

  const receivedAmount = state.bookings.reduce((sum, booking) => {
    return sum + numberValue(getValue(booking, [
      "amountReceived",
      "paidAmount",
      "receivedAmount",
      "rentReceived"
    ]));
  }, 0);

  const totalDueAmount = state.bookings.reduce((sum, booking) => {
    return sum + dueAmount(booking);
  }, 0);

  const pendingKyc = state.bookings.filter((booking) => {
    const kycStatus = normalize(getText(booking, ["kycStatus", "kyc_status", "verificationStatus"]));
    return !["verified", "approved", "complete", "completed"].includes(kycStatus);
  }).length;

  const moveInsThisMonth = state.bookings.filter((booking) => {
    return isThisMonth(booking.checkIn || booking.check_in || booking.checkInDate || booking.moveInDate);
  }).length;

  const activeLeads = state.leads.filter((lead) => {
    const status = normalize(getText(lead, ["status", "leadStage", "stage"]));
    return !["converted", "lost", "closed"].includes(status);
  }).length;

  const followUpsDue = all.filter(isFollowUpDue).length;

  const convertedLeads = state.leads.filter((lead) => {
    return normalize(getText(lead, ["status", "leadStage", "stage"])) === "converted";
  }).length;

  const conversionRate = state.leads.length
    ? Math.round((convertedLeads / state.leads.length) * 100)
    : 0;

  const duePayments = state.bookings.filter((booking) => {
    const paymentStatus = getText(booking, ["paymentStatus", "payment_status"]);
    return dueAmount(booking) > 0 || isPaymentDue(paymentStatus);
  }).length;

  return {
    all,
    totalBookings,
    confirmedCheckIns,
    bookingValueTotal,
    receivedAmount,
    totalDueAmount,
    pendingKyc,
    moveInsThisMonth,
    activeLeads,
    followUpsDue,
    conversionRate,
    duePayments
  };
}

function groupCount(items, getter) {
  const map = new Map();

  items.forEach((item) => {
    const label = cleanLabel(getter(item) || "Unknown");
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function renderMiniList(id, rows, emptyText = "No data yet.") {
  const box = $(id);
  if (!box) return;

  if (!rows.length) {
    box.innerHTML = `<div class="mini-row"><span>${emptyText}</span><strong>0</strong></div>`;
    return;
  }

  box.innerHTML = rows.slice(0, 5).map(([label, value]) => `
    <div class="mini-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderStats() {
  const data = calculate();

  setText("totalBookingsValue", data.totalBookings);
  setText("confirmedCheckinsValue", data.confirmedCheckIns);
  setText("bookingValueValue", shortMoney(data.bookingValueTotal));
  setText("activeResidentsValue", data.confirmedCheckIns);
  setText("activeLeadsValue", data.activeLeads);
  setText("pendingKycValue", data.pendingKyc);
  setText("moveInsValue", data.moveInsThisMonth);
  setText("followupsDueValue", data.followUpsDue);
  setText("conversionRateValue", `${data.conversionRate}%`);
  setText("dueAmountValue", shortMoney(data.totalDueAmount));
  setText("dueAmountSub", `${data.duePayments} pending payments`);

  setText("miniBookingValue", shortMoney(data.bookingValueTotal));
  setText("miniReceivedAmount", shortMoney(data.receivedAmount));
  setText("miniDueAmount", shortMoney(data.totalDueAmount));

  renderMiniList("statusMiniList", groupCount(data.all, (item) => item.stage));
  renderMiniList("roomMiniList", groupCount(data.all, (item) => item.roomType));
  renderMiniList("propertyMiniList", groupCount(data.all, (item) => item.propertyName));
}

function renderSelectOptions(id, values, fallback) {
  const select = $(id);
  if (!select) return;

  const current = select.value || fallback;

  select.innerHTML = values.map((value) => {
    return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
  }).join("");

  select.value = values.includes(current) ? current : fallback;
}

function renderFilters() {
  const all = records();

  renderSelectOptions(
    "propertyFilter",
    ["All Properties", ...new Set(all.map((item) => item.propertyName).filter(Boolean))],
    "All Properties"
  );

  renderSelectOptions(
    "statusFilter",
    ["All Statuses", ...new Set(all.map((item) => item.stage).filter(Boolean))],
    "All Statuses"
  );

  renderSelectOptions(
    "stayTypeFilter",
    ["All Stay Types", ...new Set(all.map((item) => item.stayType).filter(Boolean))],
    "All Stay Types"
  );
}

function filteredRecords() {
  let all = records();

  const query = normalize($("bookingSearchInput")?.value) || normalize($("topSearchInput")?.value);
  const property = $("propertyFilter")?.value || "All Properties";
  const type = $("typeFilter")?.value || "All Types";
  const status = $("statusFilter")?.value || "All Statuses";
  const stayType = $("stayTypeFilter")?.value || "All Stay Types";
  const roomType = $("roomTypeFilter")?.value || "All Room Types";
  const sort = $("sortFilter")?.value || "Recently Added";

  if (query) {
    all = all.filter((record) => {
      const haystack = [
        record.name,
        record.phone,
        record.email,
        record.referenceNo,
        record.propertyName,
        record.roomType,
        record.source
      ].join(" ").toLowerCase();

      return haystack.includes(query);
    });
  }

  if (property !== "All Properties") all = all.filter((record) => record.propertyName === property);
  if (type !== "All Types") all = all.filter((record) => record.typeLabel === type);
  if (status !== "All Statuses") all = all.filter((record) => record.stage === status);
  if (stayType !== "All Stay Types") all = all.filter((record) => record.stayType === stayType);
  if (roomType !== "All Room Types") all = all.filter((record) => record.roomType === roomType);

  all.sort((a, b) => {
    if (sort === "Booking Value") return b.amount - a.amount;

    if (sort === "Follow-up Date") {
      const aTime = a.followUpDate?.getTime() || new Date(2200, 0, 1).getTime();
      const bTime = b.followUpDate?.getTime() || new Date(2200, 0, 1).getTime();
      return aTime - bTime;
    }

    if (sort === "Name A-Z") return a.name.localeCompare(b.name);

    return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
  });

  return all;
}

function stageColor(stage) {
  const value = normalize(stage);

  if (value.includes("confirmed") || value.includes("converted") || value.includes("active")) return "#2e8a4e";
  if (value.includes("follow")) return "#e18a00";
  if (value.includes("new")) return "#7a1024";
  if (value.includes("proposal")) return "#6352c7";

  return "#061b32";
}

function paymentColor(status) {
  return isPaymentDue(status) ? "#7a1024" : "#2e8a4e";
}

function softColor(color) {
  return `${color}18`;
}

function renderPipeline() {
  const box = $("pipelineList");
  if (!box) return;

  const all = filteredRecords();
  const totalPages = Math.max(1, Math.ceil(all.length / state.rowsPerPage));

  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const page = all.slice(start, start + state.rowsPerPage);

  setText("pipelineSub", `${all.length} records shown`);

  if (!page.length) {
    box.innerHTML = `<div class="empty-state">No records found. Add a lead or resident booking to show records here.</div>`;
    setText("tableSummary", "Showing 0 records");
    renderPagination(totalPages);
    return;
  }

  box.innerHTML = page.map((record) => {
    const sColor = stageColor(record.stage);
    const pColor = paymentColor(record.paymentStatus);

    return `
      <article class="pipeline-record">
        <div class="record-avatar">${escapeHtml(initials(record.name).slice(0, 1))}</div>

        <div class="record-text">
          <strong>${escapeHtml(record.name)}</strong>
          <span>${escapeHtml(record.phone || record.email || "No contact added")}</span>
        </div>

        <div class="record-text desktop-col">
          <strong>${escapeHtml(record.referenceNo)}</strong>
          <span>${escapeHtml(record.typeLabel)}</span>
        </div>

        <div class="record-text desktop-col">
          <strong>${escapeHtml(record.propertyName)}</strong>
          <span>${escapeHtml(record.roomNo ? `Room ${record.roomNo}${record.bedNo ? ` / Bed ${record.bedNo}` : ""}` : `${record.roomType} • ${record.stayType}`)}</span>
        </div>

        <div class="record-text desktop-col">
          <strong>${escapeHtml(money(record.amount))}</strong>
          <span>${escapeHtml(record.source)}</span>
        </div>

        <div class="desktop-col">
          <span class="record-chip" style="background:${softColor(sColor)};color:${sColor}">
            ${escapeHtml(record.stage)}
          </span>
        </div>

        <div class="desktop-col">
          <span class="record-chip" style="background:${softColor(pColor)};color:${pColor}">
            ${escapeHtml(record.paymentStatus)}
          </span>
        </div>

        <div class="record-actions">
          ${
            record.isLead
              ? `
                <button type="button" data-edit-lead="${escapeHtml(record.id)}" title="Edit Lead">
                  <i class="fa-regular fa-pen-to-square"></i>
                </button>

                <button type="button" data-convert-lead="${escapeHtml(record.id)}" title="Convert to Booking">
                  <i class="fa-solid fa-user-plus"></i>
                </button>
              `
              : `
                <button type="button" title="Booking">
                  <i class="fa-regular fa-eye"></i>
                </button>
              `
          }
        </div>
      </article>
    `;
  }).join("");

  box.querySelectorAll("[data-edit-lead]").forEach((button) => {
    button.addEventListener("click", () => {
      const lead = state.leads.find((item) => item.id === button.dataset.editLead);
      if (lead) openLeadModal(getLeadRecord(lead));
    });
  });

  box.querySelectorAll("[data-convert-lead]").forEach((button) => {
    button.addEventListener("click", () => {
      const lead = state.leads.find((item) => item.id === button.dataset.convertLead);
      if (lead) openBookingModal(getLeadRecord(lead));
    });
  });

  setText("tableSummary", `Showing ${start + 1} to ${start + page.length} of ${all.length} records`);

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = $("pagination");
  if (!container) return;

  container.innerHTML = "";

  for (let page = 1; page <= Math.min(totalPages, 8); page++) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = page;
    button.className = page === state.currentPage ? "active" : "";

    button.addEventListener("click", () => {
      state.currentPage = page;
      renderPipeline();
    });

    container.appendChild(button);
  }
}

function renderLeadPropertyOptions() {
  const select = $("leadPropertyInput");
  if (!select) return;

  const current = select.value;

  select.innerHTML = `
    <option value="">Select property</option>
    ${state.properties.map((property) => `
      <option value="${escapeHtml(property.id)}">${escapeHtml(propertyName(property))}</option>
    `).join("")}
  `;

  if (state.properties.some((property) => property.id === current)) {
    select.value = current;
  }
}

function renderBookingPropertyOptions() {
  const select = $("bookingPropertyInput");
  if (!select) return;

  const current = select.value;

  select.innerHTML = `
    <option value="">Select property</option>
    ${state.properties.map((property) => {
      const advance = propertyAdvanceRent(property);

      return `
        <option value="${escapeHtml(property.id)}">
          ${escapeHtml(propertyName(property))}${advance > 0 ? ` • Advance ${money(advance)}` : ""}
        </option>
      `;
    }).join("")}
  `;

  if (state.properties.some((property) => property.id === current)) {
    select.value = current;
  }
}

function renderBookingRooms() {
  const select = $("bookingRoomInput");
  if (!select) return;

  const propertyId = $("bookingPropertyInput")?.value || "";
  const type = $("bookingRoomTypeInput")?.value || "All Room Types";
  const current = select.value;
  const rooms = propertyId ? availableRooms(propertyId, type) : [];

  select.innerHTML = `
    <option value="">${rooms.length ? "Select available room" : "No available room found"}</option>
    ${rooms.map((room) => {
      const capacity = numberValue(getValue(room, [
        "sharingCapacity",
        "capacity",
        "totalBeds",
        "bedCount"
      ]));

      const rType = roomTypeBucket(getText(room, ["roomType", "sharingType", "type"]), capacity);
      const cool = coolingType(getText(room, ["coolingType", "roomCooling", "cooling"]));
      const rent = roomRent(room);
      const beds = availableBeds(room.id);

      return `
        <option value="${escapeHtml(room.id)}">
          Room ${escapeHtml(roomNo(room))} • ${rType} • ${cool} • Rent ${money(rent)} • ${beds.length} beds available
        </option>
      `;
    }).join("")}
  `;

  if (rooms.some((room) => room.id === current)) {
    select.value = current;
  }
}

function renderBookingBeds() {
  const select = $("bookingBedInput");
  if (!select) return;

  const roomId = $("bookingRoomInput")?.value || "";
  const current = select.value;
  const beds = roomId ? availableBeds(roomId) : [];

  select.innerHTML = `
    <option value="">No bed selected</option>
    ${beds.map((bed) => `
      <option value="${escapeHtml(bed.id)}">
        Bed ${escapeHtml(bedNo(bed))} • Rent ${money(bedRent(bed))} • Available
      </option>
    `).join("")}
  `;

  if (beds.some((bed) => bed.id === current)) {
    select.value = current;
  }
}

function renderFoodPlans() {
  const select = $("foodPlanInput");
  if (!select) return;

  const current = select.value;
  const plans = state.foodPlans.filter((plan) => plan.isActive !== false);

  select.innerHTML = `
    <option value="">Select food type</option>
    ${plans.map((plan) => {
      const name = getText(plan, ["planName", "name"]) || "Food Plan";
      const type = getText(plan, ["foodType", "type"]) || "Food";
      const price = numberValue(getValue(plan, ["monthlyPrice", "price", "amount"]));

      return `
        <option value="${escapeHtml(plan.id)}">
          ${escapeHtml(type)} • ${escapeHtml(name)} • ${money(price)}
        </option>
      `;
    }).join("")}
  `;

  if (plans.some((plan) => plan.id === current)) {
    select.value = current;
  }
}

function renderFormOptions() {
  renderLeadPropertyOptions();
  renderBookingPropertyOptions();
  renderBookingRooms();
  renderBookingBeds();
  renderFoodPlans();
}

function syncAdvanceRent() {
  const property = state.properties.find((item) => item.id === $("bookingPropertyInput")?.value);
  const amount = property ? propertyAdvanceRent(property) : 0;

  if ($("bookingAdvanceRentInput")) {
    $("bookingAdvanceRentInput").value = amount > 0 ? Math.round(amount) : "";
  }
}

function syncRent() {
  const room = state.rooms.find((item) => item.id === $("bookingRoomInput")?.value);
  const bed = state.beds.find((item) => item.id === $("bookingBedInput")?.value);
  const rent = bed ? bedRent(bed) : room ? roomRent(room) : 0;

  if ($("bookingRentInput")) {
    $("bookingRentInput").value = rent > 0 ? Math.round(rent) : "";
  }
}

function selectedFoodPlan() {
  return state.foodPlans.find((plan) => plan.id === $("foodPlanInput")?.value) || null;
}

function foodAmount() {
  const plan = selectedFoodPlan();
  if (!plan) return 0;

  let amount = numberValue(getValue(plan, ["monthlyPrice", "price", "amount"]));

  if ($("morningTeaInput")?.checked && (plan.bedCoffeeAvailable === true || plan.morningTeaAvailable === true)) {
    amount += numberValue(getValue(plan, ["bedCoffeePrice", "morningTeaPrice", "teaPrice"]));
  }

  if ($("eveningTeaInput")?.checked && (plan.eveningTiffinAvailable === true || plan.eveningTeaAvailable === true)) {
    amount += numberValue(getValue(plan, ["eveningTiffinPrice", "eveningTeaPrice"]));
  }

  return amount;
}

function syncFoodAmount() {
  const amount = foodAmount();
  const plan = selectedFoodPlan();

  if ($("foodAmountInput")) {
    $("foodAmountInput").value = amount > 0 ? Math.round(amount) : "";
  }

  const summary = $("foodSummaryBox");
  if (!summary) return;

  if (!plan) {
    summary.textContent = "Select a food type to fetch price.";
    return;
  }

  const name = getText(plan, ["planName", "name"]) || "Food Plan";
  const type = getText(plan, ["foodType", "type"]) || "Food";
  const cuisine = getText(plan, ["cuisineType", "cuisine"]) || "Both South & North";

  summary.innerHTML = `
    <strong>${escapeHtml(type)} • ${escapeHtml(name)}</strong><br>
    Cuisine: ${escapeHtml(cuisine)}<br>
    Total: ${money(amount)}
  `;
}

function openModal(id) {
  const modal = $(id);

  if (!modal) {
    toast(`${id} not found in HTML.`, true);
    return;
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  if (state.saving) return;

  const modal = $(id);
  if (!modal) return;

  modal.hidden = true;
  document.body.style.overflow = "";
}

function leadStageValue(value) {
  const normalized = normalize(value).replaceAll("-", "_").replaceAll(" ", "_");

  const allowed = [
    "new_lead",
    "follow_up",
    "negotiation",
    "proposal_sent",
    "converted",
    "lost"
  ];

  if (allowed.includes(normalized)) return normalized;
  if (normalized.includes("follow")) return "follow_up";
  if (normalized.includes("proposal")) return "proposal_sent";
  if (normalized.includes("convert")) return "converted";
  if (normalized.includes("lost")) return "lost";
  if (normalized.includes("nego")) return "negotiation";

  return "new_lead";
}

function openLeadModal(record = null) {
  $("leadForm")?.reset();

  if ($("leadEditId")) $("leadEditId").value = record?.id || "";
  setText("leadModalTitle", record ? "Edit Lead" : "Add Lead");

  if ($("saveLeadBtn")) {
    $("saveLeadBtn").innerHTML = record
      ? `<i class="fa-solid fa-check"></i>Update Lead`
      : `<i class="fa-solid fa-check"></i>Save Lead`;
  }

  if ($("convertLeadBtn")) {
    $("convertLeadBtn").hidden = !record;
  }

  renderLeadPropertyOptions();

  if (record) {
    if ($("leadNoInput")) $("leadNoInput").value = record.referenceNo || "";
    if ($("leadNameInput")) $("leadNameInput").value = record.name || "";
    if ($("leadPhoneInput")) $("leadPhoneInput").value = record.phone || "";
    if ($("leadEmailInput")) $("leadEmailInput").value = record.email || "";
    if ($("leadPropertyInput")) $("leadPropertyInput").value = record.propertyId || "";
    if ($("leadSourceInput")) $("leadSourceInput").value = record.source || "Website";
    if ($("leadRoomTypeInput")) $("leadRoomTypeInput").value = record.roomType || "Single";
    if ($("leadStayTypeInput")) $("leadStayTypeInput").value = record.stayType || "Monthly Stay";
    if ($("leadStageInput")) $("leadStageInput").value = leadStageValue(record.stage);
    if ($("leadBudgetInput")) $("leadBudgetInput").value = record.amount > 0 ? Math.round(record.amount) : "";

    if ($("leadFollowUpInput")) {
      $("leadFollowUpInput").value = record.followUpDate
        ? dateInputValue(record.followUpDate)
        : dateInputValue(new Date(Date.now() + 86400000));
    }

    const raw = record.raw || {};
    const expectedMoveIn = toDate(raw.expectedMoveIn || raw.moveInDate);

    if ($("leadExpectedMoveInInput")) {
      $("leadExpectedMoveInInput").value = expectedMoveIn ? dateInputValue(expectedMoveIn) : "";
    }

    if ($("leadNotesInput")) {
      $("leadNotesInput").value = getText(raw, ["notes", "leadNotes"]);
    }
  } else {
    if ($("leadStageInput")) $("leadStageInput").value = "new_lead";
    if ($("leadFollowUpInput")) $("leadFollowUpInput").value = dateInputValue(new Date(Date.now() + 86400000));
    if ($("leadExpectedMoveInInput")) $("leadExpectedMoveInInput").value = "";
  }

  openModal("leadModal");
}

function closeLeadModal() {
  closeModal("leadModal");
}

function openBookingModal(initialLead = null) {
  $("bookingForm")?.reset();

  state.kycFiles = [];
  renderKycFiles();

  if ($("convertedLeadId")) $("convertedLeadId").value = initialLead?.id || "";

  renderFormOptions();

  if ($("bookingCheckInInput")) $("bookingCheckInInput").value = dateInputValue(new Date());
  if ($("bookingKycStatusInput")) $("bookingKycStatusInput").value = "pending";
  if ($("bookingSourceInput")) $("bookingSourceInput").value = "Manual Entry";
  if ($("bookingStayTypeInput")) $("bookingStayTypeInput").value = "Monthly Stay";
  if ($("bookingRoomTypeInput")) $("bookingRoomTypeInput").value = "All Room Types";
  if ($("foodBillingInput")) $("foodBillingInput").value = "No Food";
  if ($("foodOptionsBox")) $("foodOptionsBox").hidden = true;

  if (initialLead) {
    if ($("bookingNameInput")) $("bookingNameInput").value = initialLead.name || "";
    if ($("bookingPhoneInput")) $("bookingPhoneInput").value = initialLead.phone || "";
    if ($("bookingEmailInput")) $("bookingEmailInput").value = initialLead.email || "";
    if ($("bookingPropertyInput")) $("bookingPropertyInput").value = initialLead.propertyId || "";
    if ($("bookingRoomTypeInput")) $("bookingRoomTypeInput").value = initialLead.roomType || "All Room Types";
    if ($("bookingStayTypeInput")) $("bookingStayTypeInput").value = initialLead.stayType || "Monthly Stay";
    if ($("bookingSourceInput")) $("bookingSourceInput").value = initialLead.source || "Manual Entry";
    if ($("bookingNotesInput")) $("bookingNotesInput").value = `Converted from lead ${initialLead.referenceNo}`;

    syncAdvanceRent();
    renderBookingRooms();
    renderBookingBeds();
    syncRent();
  }

  openModal("bookingModal");
}

function closeBookingModal() {
  closeModal("bookingModal");
}

function renderKycFiles() {
  const box = $("kycFilesList");
  if (!box) return;

  if (!state.kycFiles.length) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = state.kycFiles.map((file, index) => `
    <div class="file-pill">
      <span>${escapeHtml(file.name)} • ${Math.round(file.size / 1024)} KB</span>
      <button type="button" data-remove-kyc="${index}">Remove</button>
    </div>
  `).join("");

  box.querySelectorAll("[data-remove-kyc]").forEach((button) => {
    button.addEventListener("click", () => {
      state.kycFiles.splice(Number(button.dataset.removeKyc), 1);
      renderKycFiles();
    });
  });
}

function kycDocsMetadata() {
  return state.kycFiles.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type || "",
    source: "website_admin",
    uploadedAt: Timestamp.now(),
    note: "File metadata saved from website admin."
  }));
}

function setSaving(buttonId, saving, label) {
  state.saving = saving;

  const button = $(buttonId);
  if (!button) return;

  button.disabled = saving;
  button.innerHTML = saving
    ? `<i class="fa-solid fa-spinner fa-spin"></i>${label}`
    : `<i class="fa-solid fa-check"></i>${label}`;
}

async function saveLead(event) {
  event.preventDefault();

  if (state.saving) return;

  const name = safeText($("leadNameInput")?.value);
  const phone = safeText($("leadPhoneInput")?.value);

  if (!name || !phone) {
    toast("Lead name and phone number are required.", true);
    return;
  }

  setSaving("saveLeadBtn", true, "Saving...");

  try {
    const editingId = safeText($("leadEditId")?.value);

    const leadRef = editingId
      ? doc(db, COLLECTIONS.leads, editingId)
      : doc(collection(db, COLLECTIONS.leads));

    const propertyId = safeText($("leadPropertyInput")?.value);
    const property = state.properties.find((item) => item.id === propertyId);

    const leadNoInput = safeText($("leadNoInput")?.value);
    const leadNo = leadNoInput || (editingId ? editingId : `LD-${leadRef.id.slice(0, 6).toUpperCase()}`);

    const data = {
      leadId: leadNo,
      leadNo,
      name,
      leadName: name,
      phone,
      email: safeText($("leadEmailInput")?.value),
      propertyId: property?.id || "",
      propertyName: property ? propertyName(property) : "",
      source: safeText($("leadSourceInput")?.value) || "Website",
      roomType: safeText($("leadRoomTypeInput")?.value) || "Single",
      stayType: safeText($("leadStayTypeInput")?.value) || "Monthly Stay",
      status: safeText($("leadStageInput")?.value) || "new_lead",
      leadStage: safeText($("leadStageInput")?.value) || "new_lead",
      followUpDate: timestampFromInput($("leadFollowUpInput")?.value),
      expectedMoveIn: timestampFromInput($("leadExpectedMoveInInput")?.value),
      budget: numberValue($("leadBudgetInput")?.value),
      notes: safeText($("leadNotesInput")?.value),
      sourcePlatform: "website_admin",
      updatedAt: serverTimestamp()
    };

    if (!editingId) data.createdAt = serverTimestamp();

    await setDoc(leadRef, data, { merge: Boolean(editingId) });

    toast(editingId ? "Lead updated successfully." : "Lead saved successfully.");
    closeLeadModal();
  } catch (error) {
    console.error("Lead save failed:", error);
    toast(`Failed to save lead: ${error.message}`, true);
  } finally {
    setSaving("saveLeadBtn", false, safeText($("leadEditId")?.value) ? "Update Lead" : "Save Lead");
  }
}

async function saveBooking(event) {
  event.preventDefault();

  if (state.saving) return;

  const fullName = safeText($("bookingNameInput")?.value);
  const rawPhone = safeText($("bookingPhoneInput")?.value);
  const phone10 = phoneDigits(rawPhone);
  const phone = phoneWithCode(rawPhone);
  const email = safeText($("bookingEmailInput")?.value);

  if (!fullName || phone10.length < 10) {
    toast("Enter resident name and valid 10 digit phone number.", true);
    return;
  }

  const propertyId = safeText($("bookingPropertyInput")?.value);
  const roomId = safeText($("bookingRoomInput")?.value);
  const bedId = safeText($("bookingBedInput")?.value);

  const selectedProperty = state.properties.find((item) => item.id === propertyId);
  const selectedRoom = state.rooms.find((item) => item.id === roomId);
  const selectedBed = bedId ? state.beds.find((item) => item.id === bedId) : null;

  if (!selectedProperty || !selectedRoom) {
    toast("Select property and available room first.", true);
    return;
  }

  const rentAmount = numberValue($("bookingRentInput")?.value);

  if (rentAmount <= 0) {
    toast("Rent amount is not configured for selected room or bed.", true);
    return;
  }

  const rentReceived = numberValue($("bookingAmountReceivedInput")?.value);
  const rentOutstanding = Math.max(rentAmount - rentReceived, 0);
  const advanceRentAmount = numberValue($("bookingAdvanceRentInput")?.value);

  const includeFood = $("foodBillingInput")?.value === "Include Food";
  const selectedFood = includeFood ? selectedFoodPlan() : null;

  if (includeFood && !selectedFood) {
    toast("Select food type first.", true);
    return;
  }

  const foodBaseAmount = includeFood && selectedFood
    ? numberValue(getValue(selectedFood, ["monthlyPrice", "price", "amount"]))
    : 0;

  const morningTeaAmount = includeFood &&
    selectedFood &&
    $("morningTeaInput")?.checked &&
    (selectedFood.bedCoffeeAvailable === true || selectedFood.morningTeaAvailable === true)
    ? numberValue(getValue(selectedFood, ["bedCoffeePrice", "morningTeaPrice", "teaPrice"]))
    : 0;

  const eveningTeaAmount = includeFood &&
    selectedFood &&
    $("eveningTeaInput")?.checked &&
    (selectedFood.eveningTiffinAvailable === true || selectedFood.eveningTeaAvailable === true)
    ? numberValue(getValue(selectedFood, ["eveningTiffinPrice", "eveningTeaPrice"]))
    : 0;

  const foodAmountTotal = foodBaseAmount + morningTeaAmount + eveningTeaAmount;

  if (includeFood && foodAmountTotal <= 0) {
    toast("Food price is not configured for selected food type.", true);
    return;
  }

  setSaving("saveBookingBtn", true, "Saving...");

  try {
    const residentRef = doc(collection(db, COLLECTIONS.residents));
    const bookingRef = doc(collection(db, COLLECTIONS.bookings));
    const customerRef = doc(db, COLLECTIONS.customers, phone);
    const rentInvoiceRef = doc(collection(db, COLLECTIONS.invoices));
    const foodInvoiceRef = includeFood ? doc(collection(db, COLLECTIONS.invoices)) : null;

    const residentCode = `RES-${residentRef.id.slice(0, 6).toUpperCase()}`;
    const rentInvoiceNo = `INV-${rentInvoiceRef.id.slice(0, 6).toUpperCase()}`;
    const foodInvoiceNo = foodInvoiceRef ? `INV-${foodInvoiceRef.id.slice(0, 6).toUpperCase()}` : "";

    const checkInDate = $("bookingCheckInInput")?.value
      ? new Date(`${$("bookingCheckInInput").value}T00:00:00`)
      : new Date();

    const checkOutDate = $("bookingCheckOutInput")?.value
      ? new Date(`${$("bookingCheckOutInput").value}T00:00:00`)
      : null;

    const billingPeriod = checkInDate.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric"
    });

    const invoiceDueDate = new Date(checkInDate);
    invoiceDueDate.setDate(invoiceDueDate.getDate() + 7);

    const paymentStatus = rentReceived <= 0
      ? "unpaid"
      : rentOutstanding <= 0
        ? "paid"
        : "partial";

    const roomNumber = roomNo(selectedRoom);
    const bedNumber = selectedBed ? bedNo(selectedBed) : "";
    const roomType = roomTypeBucket(getText(selectedRoom, ["roomType", "sharingType", "type"]));
    const cool = coolingType(getText(selectedRoom, ["coolingType", "roomCooling", "cooling"]));
    const propertyTitle = propertyName(selectedProperty);
    const stayType = safeText($("bookingStayTypeInput")?.value) || "Monthly Stay";
    const source = safeText($("bookingSourceInput")?.value) || "Manual Entry";
    const kycStatus = safeText($("bookingKycStatusInput")?.value) || "pending";
    const notes = safeText($("bookingNotesInput")?.value);

    const foodPlanName = selectedFood ? getText(selectedFood, ["planName", "name"]) || "Food Plan" : "";
    const foodType = selectedFood ? getText(selectedFood, ["foodType", "type"]) || "Food" : "";
    const foodCuisine = selectedFood ? getText(selectedFood, ["cuisineType", "cuisine"]) : "";

    const commonData = {
      customerId: phone,
      customerDocId: phone,
      name: fullName,
      fullName,
      phone,
      phoneDigits: phone10,
      rawPhone,
      email,
      propertyId: selectedProperty.id,
      propertyName: propertyTitle,
      roomId: selectedRoom.id,
      roomNo: roomNumber,
      roomName: `Room ${roomNumber}`,
      roomType,
      sharingType: roomType,
      coolingType: cool,
      roomCooling: cool,
      bedId: selectedBed?.id || null,
      bedNo: bedNumber || null,
      bedName: selectedBed ? `Bed ${bedNumber}` : null,
      bedRent: selectedBed ? bedRent(selectedBed) : 0,
      rentSource: selectedBed && bedRent(selectedBed) > 0 ? "bed" : "room",
      stayType,
      checkIn: Timestamp.fromDate(checkInDate),
      checkOut: checkOutDate ? Timestamp.fromDate(checkOutDate) : null,
      kycStatus,
      kycDocs: kycDocsMetadata(),
      paymentStatus,
      totalAmount: rentAmount,
      amountReceived: rentReceived,
      paidAmount: rentReceived,
      outstandingAmount: rentOutstanding,
      rentAmount,
      rentReceived,
      rentOutstandingAmount: rentOutstanding,
      advanceRentAmount,
      advanceRent: advanceRentAmount,
      advanceRentStatus: advanceRentAmount > 0 ? "pending" : "not_applicable",
      foodOpted: includeFood,
      foodPlanId: includeFood ? selectedFood?.id : null,
      foodPlan: includeFood ? foodPlanName : "",
      foodType: includeFood ? foodType : "",
      foodCuisine: includeFood ? foodCuisine : "",
      foodBaseAmount,
      includeMorningTea: includeFood && morningTeaAmount > 0,
      morningTeaAmount,
      includeEveningTea: includeFood && eveningTeaAmount > 0,
      eveningTeaAmount,
      foodAmount: foodAmountTotal,
      foodBillingStatus: includeFood ? "unpaid" : "not_applicable",
      source,
      sourcePlatform: "website_admin",
      notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);

    batch.set(customerRef, {
      customerId: phone,
      phone,
      phoneDigits: phone10,
      rawPhone,
      countryCode: "+91",
      name: fullName,
      fullName,
      email,
      userType: "customer",
      isActive: true,
      isResident: true,
      currentBookingId: bookingRef.id,
      currentResidentId: residentRef.id,
      currentResidentCode: residentCode,
      residentStatus: "active",
      currentPropertyId: selectedProperty.id,
      currentPropertyName: propertyTitle,
      currentRoomId: selectedRoom.id,
      currentRoomNo: roomNumber,
      currentRoomName: `Room ${roomNumber}`,
      currentBedId: selectedBed?.id || null,
      currentBedNo: bedNumber || null,
      currentBedName: selectedBed ? `Bed ${bedNumber}` : null,
      advanceRentAmount,
      currentAdvanceRentAmount: advanceRentAmount,
      lastBookingSource: "website_admin",
      lastBookingAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    batch.set(residentRef, {
      ...commonData,
      residentId: residentCode,
      residentCode,
      bookingId: bookingRef.id,
      status: "active",
      residentStatus: "active",
      createdFrom: "website_admin_booking",
      emergencyContactName: safeText($("emergencyNameInput")?.value),
      emergencyContactPhone: safeText($("emergencyPhoneInput")?.value)
    });

    batch.set(bookingRef, {
      ...commonData,
      bookingId: bookingRef.id,
      residentDocId: residentRef.id,
      residentId: residentRef.id,
      residentCode,
      residentName: fullName,
      guestName: fullName,
      status: "confirmed",
      bookingStatus: "confirmed",
      bookingSource: "website_admin",
      paymentMode: "offline",
      amount: rentAmount,
      bookingAmount: rentAmount
    });

    batch.set(rentInvoiceRef, {
      invoiceNo: rentInvoiceNo,
      bookingId: bookingRef.id,
      customerId: phone,
      customerDocId: phone,
      residentId: residentRef.id,
      residentCode,
      residentName: fullName,
      phone,
      phoneDigits: phone10,
      rawPhone,
      email,
      propertyId: selectedProperty.id,
      propertyName: propertyTitle,
      roomId: selectedRoom.id,
      roomNo: roomNumber,
      bedId: selectedBed?.id || null,
      bedNo: bedNumber || null,
      billingPeriod,
      dueDate: Timestamp.fromDate(invoiceDueDate),
      category: "Rent",
      invoiceType: "rent",
      lineItems: [{
        name: "Rent",
        category: "Rent",
        amount: rentAmount,
        subtotal: rentAmount,
        taxRate: 0,
        taxAmount: 0,
        total: rentAmount
      }],
      subtotal: rentAmount,
      taxAmount: 0,
      totalAmount: rentAmount,
      amountReceived: rentReceived,
      paidAmount: rentReceived,
      balanceAmount: rentOutstanding,
      pendingAmount: rentOutstanding,
      outstandingAmount: rentOutstanding,
      paymentStatus,
      paymentMode: "UPI",
      notes: "Auto-created rent invoice from website booking.",
      source: "website_booking_auto_invoice",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (rentReceived > 0) {
      const transactionRef = doc(collection(db, COLLECTIONS.transactions));

      batch.set(transactionRef, {
        transactionId: transactionRef.id,
        invoiceId: rentInvoiceRef.id,
        invoiceNo: rentInvoiceNo,
        bookingId: bookingRef.id,
        customerId: phone,
        customerDocId: phone,
        residentId: residentRef.id,
        residentName: fullName,
        propertyId: selectedProperty.id,
        propertyName: propertyTitle,
        amount: rentReceived,
        paymentMode: "UPI",
        paymentStatus,
        type: "rent_invoice_payment",
        category: "Rent",
        source: "website_admin",
        createdAt: serverTimestamp()
      });
    }

    if (includeFood && foodInvoiceRef) {
      batch.set(foodInvoiceRef, {
        invoiceNo: foodInvoiceNo,
        bookingId: bookingRef.id,
        customerId: phone,
        customerDocId: phone,
        residentId: residentRef.id,
        residentCode,
        residentName: fullName,
        phone,
        phoneDigits: phone10,
        rawPhone,
        email,
        propertyId: selectedProperty.id,
        propertyName: propertyTitle,
        roomId: selectedRoom.id,
        roomNo: roomNumber,
        bedId: selectedBed?.id || null,
        bedNo: bedNumber || null,
        billingPeriod,
        dueDate: Timestamp.fromDate(invoiceDueDate),
        category: "Food",
        invoiceType: "food",
        foodPlanId: selectedFood?.id,
        foodPlan: foodPlanName,
        foodType,
        foodCuisine,
        includeMorningTea: morningTeaAmount > 0,
        morningTeaAmount,
        includeEveningTea: eveningTeaAmount > 0,
        eveningTeaAmount,
        subtotal: foodAmountTotal,
        taxAmount: 0,
        totalAmount: foodAmountTotal,
        amountReceived: 0,
        paidAmount: 0,
        balanceAmount: foodAmountTotal,
        pendingAmount: foodAmountTotal,
        outstandingAmount: foodAmountTotal,
        paymentStatus: "unpaid",
        paymentMode: "UPI",
        notes: "Auto-created food invoice from website booking.",
        source: "website_booking_auto_food_invoice",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    if (selectedBed) {
      batch.set(doc(db, COLLECTIONS.beds, selectedBed.id), {
        status: "occupied",
        bedStatus: "occupied",
        isOccupied: true,
        residentId: residentRef.id,
        bookingId: bookingRef.id,
        customerId: phone,
        currentCustomerId: phone,
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (availableBeds(selectedRoom.id).length <= 1) {
        batch.set(doc(db, COLLECTIONS.rooms, selectedRoom.id), {
          status: "occupied",
          roomStatus: "occupied",
          residentId: residentRef.id,
          bookingId: bookingRef.id,
          customerId: phone,
          currentCustomerId: phone,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    } else {
      batch.set(doc(db, COLLECTIONS.rooms, selectedRoom.id), {
        status: "occupied",
        roomStatus: "occupied",
        residentId: residentRef.id,
        bookingId: bookingRef.id,
        customerId: phone,
        currentCustomerId: phone,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "New resident booking",
      message: `${fullName} booked Room ${roomNumber}.`,
      type: "booking",
      module: "Bookings",
      customerId: phone,
      residentId: residentRef.id,
      bookingId: bookingRef.id,
      isRead: false,
      adminRead: false,
      source: "website_admin",
      createdAt: serverTimestamp()
    });

    const convertedLeadId = safeText($("convertedLeadId")?.value);

    if (convertedLeadId) {
      batch.set(doc(db, COLLECTIONS.leads, convertedLeadId), {
        status: "converted",
        leadStage: "converted",
        convertedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await batch.commit();

    toast("Booking, resident and customer profile saved successfully.");
    closeBookingModal();
  } catch (error) {
    console.error("Booking save failed:", error);
    toast(`Failed to save booking: ${error.message}`, true);
  } finally {
    setSaving("saveBookingBtn", false, "Save Booking");
  }
}

function clearFilters() {
  if ($("bookingSearchInput")) $("bookingSearchInput").value = "";
  if ($("topSearchInput")) $("topSearchInput").value = "";
  if ($("propertyFilter")) $("propertyFilter").value = "All Properties";
  if ($("typeFilter")) $("typeFilter").value = "All Types";
  if ($("statusFilter")) $("statusFilter").value = "All Statuses";
  if ($("stayTypeFilter")) $("stayTypeFilter").value = "All Stay Types";
  if ($("roomTypeFilter")) $("roomTypeFilter").value = "All Room Types";
  if ($("sortFilter")) $("sortFilter").value = "Recently Added";

  state.currentPage = 1;
  renderPipeline();
}

function exportCsv() {
  const rows = filteredRecords();

  const header = [
    "Type",
    "Reference",
    "Name",
    "Phone",
    "Email",
    "Property",
    "Room",
    "Bed",
    "Room Type",
    "Stay Type",
    "Status",
    "Payment Status",
    "Amount",
    "Due Amount",
    "Source"
  ];

  const csv = [
    header.join(","),
    ...rows.map((item) => [
      item.typeLabel,
      item.referenceNo,
      item.name,
      item.phone,
      item.email,
      item.propertyName,
      item.roomNo,
      item.bedNo,
      item.roomType,
      item.stayType,
      item.stage,
      item.paymentStatus,
      item.amount,
      item.dueAmount,
      item.source
    ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `bookings-leads-${dateInputValue(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function renderPage() {
  renderStats();
  renderFilters();
  renderPipeline();
  renderFormOptions();
}

function setupAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "../index.html";
      return;
    }

    const name = user.displayName || "Admin";
    const email = user.email || "admin@email.com";
    const short = initials(name || email);

    setText("adminName", name);
    setText("dropdownAdminName", name);
    setText("dropdownAdminEmail", email);
    setText("adminAvatar", short);
    setText("adminAvatarSmall", short);

    const passwordAccountText = $("passwordAccountText");
    if (passwordAccountText) {
      passwordAccountText.textContent = `Account: ${email}`;
    }
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.clear();
    window.location.href = "../index.html";
  });

  $("changePasswordBtn")?.addEventListener("click", () => {
    $("passwordModal").hidden = false;
    $("profileDropdown")?.classList.remove("show");
  });

  $("cancelPasswordBtn")?.addEventListener("click", () => {
    $("passwordModal").hidden = true;
    $("passwordForm")?.reset();
  });

  $("passwordModal")?.addEventListener("click", (event) => {
    if (event.target.id === "passwordModal") {
      $("passwordModal").hidden = true;
      $("passwordForm")?.reset();
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
      $("passwordForm")?.reset();
      toast("Password changed successfully.");
    } catch (error) {
      const message =
        error?.code === "auth/requires-recent-login"
          ? "For security, logout and login again, then change password."
          : error?.message || "Password change failed.";

      toast(message, true);
    }
  });
}

function setupLayoutControls() {
  const adminApp = $("adminApp");
  const sidebar = $("sidebar");
  const menuBtn = $("menuBtn");
  const mobileOverlay = $("mobileOverlay");
  const profileBtn = $("adminProfileBtn");
  const profileDropdown = $("profileDropdown");
  const propertiesDropdown = $("propertiesDropdown");
  const propertiesToggle = $("propertiesToggle");

  if (localStorage.getItem("sidebarCollapsed") === "true") {
    adminApp?.classList.add("sidebar-collapsed");
  }

  menuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.innerWidth <= 950) {
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

  propertiesToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    propertiesDropdown?.classList.toggle("active");
    profileDropdown?.classList.remove("show");
  });

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
}

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
    }
  );
}

function setupFirebase() {
  listenCollection("customers", COLLECTIONS.customers);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("rooms", COLLECTIONS.rooms);
  listenCollection("beds", COLLECTIONS.beds);
  listenCollection("bookings", COLLECTIONS.bookings);
  listenCollection("leads", COLLECTIONS.leads);
  listenCollection("invoices", COLLECTIONS.invoices);
  listenCollection("transactions", COLLECTIONS.transactions);
  listenCollection("foodPlans", COLLECTIONS.foodPlans);
}

function setupEvents() {
  $("addLeadBtn")?.addEventListener("click", () => openLeadModal());
  $("quickAddLead")?.addEventListener("click", () => openLeadModal());

  $("addBookingBtn")?.addEventListener("click", () => openBookingModal());
  $("quickAddBooking")?.addEventListener("click", () => openBookingModal());

  $("closeLeadModal")?.addEventListener("click", closeLeadModal);
  $("cancelLeadBtn")?.addEventListener("click", closeLeadModal);

  $("closeBookingModal")?.addEventListener("click", closeBookingModal);
  $("cancelBookingBtn")?.addEventListener("click", closeBookingModal);

  $("leadForm")?.addEventListener("submit", saveLead);
  $("bookingForm")?.addEventListener("submit", saveBooking);

  $("convertLeadBtn")?.addEventListener("click", () => {
    const leadId = safeText($("leadEditId")?.value);
    const lead = state.leads.find((item) => item.id === leadId);

    if (lead) {
      closeLeadModal();
      openBookingModal(getLeadRecord(lead));
    }
  });

  $("quickViewBookings")?.addEventListener("click", () => {
    if ($("typeFilter")) $("typeFilter").value = "Booking";
    state.currentPage = 1;
    renderPipeline();
  });

  $("quickViewLeads")?.addEventListener("click", () => {
    if ($("typeFilter")) $("typeFilter").value = "Lead";
    state.currentPage = 1;
    renderPipeline();
  });

  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    toast("Bookings and leads refreshed.");
  });

  $("exportBtn")?.addEventListener("click", exportCsv);
  $("clearFiltersBtn")?.addEventListener("click", clearFilters);

  $("topSearchInput")?.addEventListener("input", () => {
    if ($("bookingSearchInput")) {
      $("bookingSearchInput").value = $("topSearchInput").value;
    }

    state.currentPage = 1;
    renderPipeline();
  });

  [
    "bookingSearchInput",
    "propertyFilter",
    "typeFilter",
    "statusFilter",
    "stayTypeFilter",
    "roomTypeFilter",
    "sortFilter"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    const eventName = el.tagName === "INPUT" ? "input" : "change";

    el.addEventListener(eventName, () => {
      state.currentPage = 1;
      renderPipeline();
    });
  });

  $("bookingPropertyInput")?.addEventListener("change", () => {
    syncAdvanceRent();
    renderBookingRooms();
    renderBookingBeds();
    syncRent();
  });

  $("bookingRoomTypeInput")?.addEventListener("change", () => {
    renderBookingRooms();
    renderBookingBeds();
    syncRent();
  });

  $("bookingRoomInput")?.addEventListener("change", () => {
    renderBookingBeds();
    syncRent();
  });

  $("bookingBedInput")?.addEventListener("change", syncRent);

  $("foodBillingInput")?.addEventListener("change", () => {
    const include = $("foodBillingInput").value === "Include Food";

    if ($("foodOptionsBox")) {
      $("foodOptionsBox").hidden = !include;
    }

    if (!include) {
      if ($("foodPlanInput")) $("foodPlanInput").value = "";
      if ($("morningTeaInput")) $("morningTeaInput").checked = false;
      if ($("eveningTeaInput")) $("eveningTeaInput").checked = false;
      if ($("foodAmountInput")) $("foodAmountInput").value = "";
      setText("foodSummaryBox", "Select a food type to fetch price.");
    } else {
      renderFoodPlans();
      syncFoodAmount();
    }
  });

  ["foodPlanInput", "morningTeaInput", "eveningTeaInput"].forEach((id) => {
    $(id)?.addEventListener("change", syncFoodAmount);
  });

  $("kycFilesInput")?.addEventListener("change", (event) => {
    state.kycFiles.push(...Array.from(event.target.files || []));
    event.target.value = "";
    renderKycFiles();
  });

  $("kycCameraInput")?.addEventListener("change", (event) => {
    state.kycFiles.push(...Array.from(event.target.files || []));
    event.target.value = "";
    renderKycFiles();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLeadModal();
      closeBookingModal();
      $("profileDropdown")?.classList.remove("show");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
  renderPage();
});