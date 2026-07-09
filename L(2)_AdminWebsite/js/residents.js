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
  users: "users",
  customers: "customers",
  residents: "residents",
  bookings: "bookings",
  properties: "properties",
  rooms: "rooms",
  beds: "beds",
  invoices: "invoices",
  transactions: "transactions",
  payments: "payments",
  moveOuts: "move_outs",
  moveOutSettlements: "move_out_settlements",
  notifications: "notifications",
  activityLogs: "activity_logs"
};

const COLORS = {
  navy: "#061B32",
  gold: "#B68B2D",
  burgundy: "#7A1024",
  green: "#2E8A4E",
  purple: "#6352C7",
  orange: "#E18A00",
  blue: "#4167A9",
  gray: "#667085",
  soft: "#edf0f5"
};

const state = {
  users: [],
  customers: [],
  residentsRaw: [],
  bookings: [],
  properties: [],
  rooms: [],
  beds: [],
  invoices: [],
  transactions: [],
  payments: [],
  moveOuts: [],
  moveOutSettlements: [],
  residentItems: [],
  currentPage: 1,
  rowsPerPage: 8,
  charts: {}
};

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLookupKey(value) {
  return normalize(value);
}

function normalizePhoneKey(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");

  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);

  return digits;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function money(value) {
  const number = safeNumber(value);
  const negative = number < 0;
  const raw = Math.abs(Math.round(number)).toString();

  if (raw.length <= 3) return `${negative ? "-" : ""}₹${raw}`;

  const lastThree = raw.slice(-3);
  let rest = raw.slice(0, -3);
  const parts = [];

  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }

  if (rest) parts.unshift(rest);

  return `${negative ? "-" : ""}₹${parts.join(",")},${lastThree}`;
}

function shortMoney(value) {
  const number = safeNumber(value);

  if (number >= 10000000) return `₹${(number / 10000000).toFixed(1)}Cr`;
  if (number >= 100000) return `₹${(number / 100000).toFixed(1)}L`;
  if (number >= 1000) return `₹${(number / 1000).toFixed(1)}K`;

  return money(number);
}

function firstText(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }

  return "";
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

function numberFromData(data, keys) {
  for (const key of keys) {
    const number = safeNumber(data?.[key]);
    if (number) return number;
  }

  return 0;
}

function dateFromValue(value) {
  if (!value) return null;

  if (value.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }

  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);

  if (!Number.isNaN(date.getTime())) return date;

  return null;
}

function dateFromData(data, keys) {
  for (const key of keys) {
    const date = dateFromValue(data?.[key]);
    if (date) return date;
  }

  return null;
}

function formatDate(date) {
  if (!date) return "Not added";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function isSameDay(a, b) {
  return a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function initials(name) {
  const parts = String(name || "R").trim().split(/\s+/).filter(Boolean);

  if (!parts.length) return "R";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function cleanLabel(value) {
  const raw = String(value || "").trim();

  if (!raw) return "Unknown";

  return raw
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(/\s+/)
    .map((part) => {
      if (!part) return "";
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function removeRoomPrefix(value) {
  return String(value || "").trim().replace(/^Room\s+/i, "");
}

function removeBedPrefix(value) {
  return String(value || "").trim().replace(/^Bed\s+/i, "");
}

function roomBedLabel(room, bed) {
  const cleanRoom = removeRoomPrefix(room);
  const cleanBed = removeBedPrefix(bed);

  if (cleanRoom && cleanBed) return `Room ${cleanRoom} / Bed ${cleanBed}`;
  if (cleanRoom) return `Room ${cleanRoom}`;
  if (cleanBed) return `Bed ${cleanBed}`;

  return "Not Assigned";
}

function isPaidStatus(status) {
  const clean = normalize(status);

  return [
    "paid",
    "complete",
    "completed",
    "settled",
    "success",
    "successful",
    "captured",
    "payment_success",
    "payment successful"
  ].includes(clean);
}

function isVerifiedKyc(status) {
  const clean = normalize(status);

  return ["verified", "approved", "completed", "complete"].includes(clean);
}

function isActiveBooking(status) {
  const clean = normalize(status);

  return [
    "confirmed",
    "booked",
    "approved",
    "paid",
    "payment_success",
    "payment successful",
    "active",
    "checked_in",
    "checked-in",
    "current",
    "ongoing"
  ].includes(clean);
}

function isWithinNextDays(date, days) {
  if (!date) return false;

  const now = new Date();
  const future = new Date();

  future.setDate(now.getDate() + days);

  return date >= now && date <= future;
}

function stayDuration(checkIn) {
  if (!checkIn) return "Not available";

  const days = Math.floor((Date.now() - checkIn.getTime()) / 86400000);

  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;

  const months = Math.floor(days / 30);
  const extraDays = days % 30;

  if (extraDays === 0) return `${months} month${months > 1 ? "s" : ""}`;

  return `${months} month${months > 1 ? "s" : ""} ${extraDays} days`;
}

function whatsappPhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/[^0-9]/g, "");

  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `91${digits.slice(1)}`;

  return digits;
}

function paymentReminderMessage(resident) {
  const amount = resident.outstandingAmount > 0
    ? money(resident.outstandingAmount)
    : money(resident.monthlyRent);

  return `Dear ${resident.name}, your payment is due for ${resident.propertyName}, ${resident.roomBed}. Amount due: ${amount}. Please pay as soon as possible to avoid penalty. - Lively Legacy Accommodations`;
}

function residentKeyFromData(data) {
  return firstText(data, [
    "residentId",
    "resident_id",
    "userId",
    "user_id",
    "uid",
    "customerId",
    "customer_id",
    "customerPhone",
    "residentPhone",
    "phone",
    "mobile",
    "phoneNumber",
    "phoneDigits",
    "tenantId",
    "tenant_id"
  ]);
}

function isResidentUser(data) {
  const role = normalize(firstText(data, ["role", "userRole", "type", "userType"]));

  if (["admin", "super_admin", "staff", "manager", "owner"].includes(role)) {
    return false;
  }

  if (["resident", "tenant", "guest", "customer", "user"].includes(role)) {
    return true;
  }

  return firstText(data, [
    "fullName",
    "name",
    "displayName",
    "residentName",
    "customerName",
    "phone",
    "customerPhone",
    "email"
  ]) !== "";
}

function hasConfirmedResidentBooking(booking) {
  if (!booking) return false;

  const bookingStatus = firstText(booking, [
    "bookingStatus",
    "status",
    "stayStatus",
    "checkoutStatus"
  ]);

  const paymentStatus = firstText(booking, [
    "paymentStatus",
    "payment_status",
    "paymentState",
    "paymentResult",
    "transactionStatus"
  ]);

  const paidFlag = booking.isPaid === true ||
    booking.paid === true ||
    booking.paymentDone === true ||
    booking.paymentCompleted === true;

  const hasRoomOrBed = firstText(booking, [
    "roomId",
    "roomNo",
    "roomNumber",
    "bedId",
    "bedNo",
    "bedNumber"
  ]).trim() !== "";

  const confirmedBooking = isActiveBooking(bookingStatus) ||
    normalize(bookingStatus).includes("confirm") ||
    normalize(bookingStatus).includes("approved") ||
    normalize(bookingStatus).includes("checked") ||
    normalize(bookingStatus).includes("active") ||
    normalize(bookingStatus).includes("current") ||
    normalize(bookingStatus).includes("ongoing");

  const paidBooking = paidFlag ||
    normalize(paymentStatus).includes("paid") ||
    normalize(paymentStatus).includes("success") ||
    normalize(paymentStatus).includes("complete") ||
    normalize(paymentStatus).includes("captured");

  return confirmedBooking || paidBooking || hasRoomOrBed;
}

function moveOutStatusLabel(rawStatus) {
  const clean = normalize(rawStatus);

  if (
    clean.includes("approved_by_admin") ||
    clean.includes("admin_approved") ||
    clean.includes("approved by admin")
  ) {
    return "Approved by Admin";
  }

  if (
    clean.includes("approved_by_staff") ||
    clean.includes("staff_approved") ||
    clean.includes("approved by staff")
  ) {
    return "Approved by Staff";
  }

  if (clean.includes("reject")) return "Rejected";
  if (clean.includes("cancel")) return "Cancelled";
  if (clean.includes("complete") || clean.includes("settled")) return "Completed";

  return "Request Raised";
}

function moveOutStatusColor(status) {
  const clean = normalize(status);

  if (clean.includes("admin")) return COLORS.purple;
  if (clean.includes("staff")) return COLORS.green;
  if (clean.includes("request")) return COLORS.gold;
  if (clean.includes("reject") || clean.includes("cancel")) return COLORS.burgundy;

  return COLORS.navy;
}

function statusColor(status) {
  switch (normalize(status)) {
    case "active":
      return COLORS.green;
    case "pending kyc":
      return COLORS.burgundy;
    case "due payment":
      return COLORS.orange;
    case "vacating soon":
      return COLORS.purple;
    case "request raised":
      return COLORS.gold;
    case "approved by staff":
      return COLORS.green;
    case "approved by admin":
      return COLORS.purple;
    default:
      return COLORS.navy;
  }
}

function residentStatus({
  bookingStatus,
  kycStatus,
  paymentStatus,
  checkOutDate,
  outstandingAmount,
  moveOutRequest
}) {
  const payment = normalize(paymentStatus);

  if (moveOutRequest && moveOutRequest.isActive) {
    return moveOutRequest.statusLabel;
  }

  if (!isVerifiedKyc(kycStatus)) return "Pending KYC";

  if (
    outstandingAmount > 0 ||
    payment.includes("due") ||
    payment.includes("pending") ||
    payment.includes("unpaid") ||
    payment.includes("partial")
  ) {
    return "Due Payment";
  }

  if (isWithinNextDays(checkOutDate, 30)) return "Vacating Soon";

  if (isActiveBooking(bookingStatus) || !bookingStatus) return "Active";

  return "Inactive";
}

function buildMaps() {
  const propertyNames = {};
  const roomNames = {};
  const bedNames = {};

  state.properties.forEach((property) => {
    const name = firstText(property, [
      "propertyName",
      "name",
      "title",
      "buildingName",
      "listingName"
    ]);

    propertyNames[property.id] = name || "Unknown Property";
  });

  state.rooms.forEach((room) => {
    const name = firstText(room, [
      "roomName",
      "roomNumber",
      "roomNo",
      "name",
      "title"
    ]);

    roomNames[room.id] = name ? removeRoomPrefix(name) : "Room";
  });

  state.beds.forEach((bed) => {
    const name = firstText(bed, [
      "bedName",
      "bedNumber",
      "bedNo",
      "name",
      "title"
    ]);

    bedNames[bed.id] = name ? removeBedPrefix(name) : "Bed";
  });

  return { propertyNames, roomNames, bedNames };
}

function buildOutstandingData() {
  const outstandingByResidentKey = {};
  const paymentStatusByResidentKey = {};

  function addDue(residentKey, amount, status) {
    if (!residentKey) return;

    const keys = [
      residentKey,
      normalizeLookupKey(residentKey),
      normalizePhoneKey(residentKey)
    ].filter(Boolean);

    keys.forEach((key) => {
      if (amount > 0) {
        outstandingByResidentKey[key] = (outstandingByResidentKey[key] || 0) + amount;
      }

      if (status) {
        paymentStatusByResidentKey[key] = cleanLabel(status);
      }
    });
  }

  [...state.invoices, ...state.transactions, ...state.payments].forEach((item) => {
    const key = residentKeyFromData(item);

    const status = firstText(item, [
      "status",
      "invoiceStatus",
      "paymentStatus",
      "transactionStatus",
      "billingStatus"
    ]);

    const total = numberFromData(item, [
      "totalAmount",
      "amount",
      "invoiceAmount",
      "payableAmount",
      "rentAmount",
      "monthlyRent"
    ]);

    const paid = numberFromData(item, [
      "paidAmount",
      "receivedAmount",
      "amountPaid"
    ]);

    const explicitDue = numberFromData(item, [
      "outstandingAmount",
      "dueAmount",
      "pendingAmount",
      "balanceAmount",
      "unpaidAmount"
    ]);

    const calculatedDue = Math.max(0, total - paid);
    const due = explicitDue > 0 ? explicitDue : calculatedDue;

    if (due > 0 || !isPaidStatus(status)) {
      addDue(key, due, status || "Due Payment");
    }
  });

  return { outstandingByResidentKey, paymentStatusByResidentKey };
}

function canApproveOnSelectedDate(selectedDate) {
  if (!selectedDate) return true;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedStart = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate()
  );

  return todayStart >= selectedStart;
}

function remainingDays(date) {
  if (!date) return 0;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.ceil((targetStart.getTime() - todayStart.getTime()) / 86400000);

  return Math.max(0, days);
}

function createMoveOutItem(data) {
  const rawStatus = firstNonEmpty([
    firstText(data, [
      "moveOutStatus",
      "requestStatus",
      "settlementStatus",
      "status"
    ]),
    "request_raised"
  ]);

  const sourceCollection = data.sourceCollection || data.collectionName || "";
  const docId = data.id || "";

  const moveOutDocId = firstNonEmpty([
    data.moveOutRequestId,
    data.moveOutId,
    sourceCollection === "move_outs" ? docId : ""
  ]);

  const settlementDocId = firstNonEmpty([
    data.settlementId,
    data.moveOutSettlementId,
    sourceCollection === "move_out_settlements" ? docId : "",
    moveOutDocId
  ]);

  const plannedMoveOutDate = dateFromData(data, [
    "plannedMoveOutDate",
    "selectedMoveOutDate",
    "expectedMoveOutDate",
    "moveOutDate",
    "moveoutDate",
    "scheduledMoveOutDate",
    "vacatingDate",
    "checkoutDate",
    "checkOutDate",
    "checkOut"
  ]);

  const requestedAt = dateFromData(data, [
    "requestedAt",
    "requestRaisedAt",
    "appliedAt",
    "createdAt"
  ]);

  const settlementEligibleAt = dateFromData(data, [
    "settlementEligibleAt",
    "canInitiateAfter",
    "eligibleAfter",
    "eligibleForSettlementAt"
  ]);

  const item = {
    id: docId || moveOutDocId || settlementDocId,
    moveOutDocId: moveOutDocId || docId || settlementDocId,
    settlementDocId: settlementDocId || docId || moveOutDocId,
    sourceCollection,
    bookingId: firstText(data, ["bookingId", "bookingDocId"]),
    bookingCode: firstText(data, ["bookingCode", "bookingNo", "bookingNumber"]),
    residentId: firstText(data, ["residentId", "userId", "customerId", "uid"]),
    customerName: firstText(data, ["customerName", "residentName", "name"]),
    customerPhone: firstText(data, [
      "customerPhone",
      "residentPhone",
      "phone",
      "mobile",
      "phoneDigits"
    ]),
    propertyId: firstText(data, ["propertyId"]),
    propertyName: firstText(data, ["propertyName", "property"]),
    roomNo: firstText(data, ["roomNo", "roomNumber"]),
    bedNo: firstText(data, ["bedNo", "bedNumber"]),
    reason: firstText(data, [
      "reason",
      "moveOutReason",
      "description",
      "notes",
      "additionalNotes"
    ]),
    rawStatus,
    statusLabel: moveOutStatusLabel(rawStatus),
    plannedMoveOutDate,
    requestedAt,
    settlementEligibleAt,
    createdAt: dateFromData(data, [
      "createdAt",
      "requestedAt",
      "requestRaisedAt",
      "appliedAt"
    ]),
    original: data
  };

  const clean = normalize(item.rawStatus);

  item.staffApproved = clean.includes("approved_by_staff") ||
    clean.includes("staff_approved") ||
    clean.includes("approved by staff") ||
    clean.includes("approved_by_admin") ||
    clean.includes("admin_approved") ||
    clean.includes("approved by admin");

  item.adminApproved = clean.includes("approved_by_admin") ||
    clean.includes("admin_approved") ||
    clean.includes("approved by admin");

  item.isActive = !clean.includes("rejected") &&
    !clean.includes("cancel") &&
    !clean.includes("complete") &&
    !clean.includes("settled");

  item.canApproveOnSelectedDate = canApproveOnSelectedDate(item.plannedMoveOutDate);
  item.settlementEligible = item.settlementEligibleAt
    ? item.settlementEligibleAt <= new Date()
    : false;
  item.settlementRemainingDays = remainingDays(item.settlementEligibleAt);

  item.lookupKeys = [
    item.id,
    item.moveOutDocId,
    item.settlementDocId,
    item.bookingId,
    item.bookingCode,
    item.residentId,
    item.customerPhone,
    item.customerName
  ].filter(Boolean);

  return item;
}

function buildMoveOutMap() {
  const moveOutByKey = {};

  const allMoveOuts = [
    ...state.moveOuts.map((item) => ({
      ...item,
      sourceCollection: "move_outs"
    })),
    ...state.moveOutSettlements.map((item) => ({
      ...item,
      sourceCollection: "move_out_settlements"
    }))
  ];

  function shouldReplace(oldItem, newItem) {
    if (!oldItem) return true;

    const oldDate = oldItem.createdAt || oldItem.requestedAt || new Date(1900, 0, 1);
    const newDate = newItem.createdAt || newItem.requestedAt || new Date(1900, 0, 1);

    return newDate > oldDate;
  }

  allMoveOuts.forEach((data) => {
    const item = createMoveOutItem(data);

    item.lookupKeys.forEach((key) => {
      const normalized = normalizeLookupKey(key);

      if (normalized && shouldReplace(moveOutByKey[normalized], item)) {
        moveOutByKey[normalized] = item;
      }

      const phoneKey = normalizePhoneKey(key);

      if (phoneKey && shouldReplace(moveOutByKey[phoneKey], item)) {
        moveOutByKey[phoneKey] = item;

        if (phoneKey.length === 10) {
          moveOutByKey[`91${phoneKey}`] = item;
          moveOutByKey[`+91${phoneKey}`] = item;
        }
      }
    });
  });

  return moveOutByKey;
}

function buildBookingMap() {
  const bookingByResidentKey = {};

  function bookingLookupKeys(booking) {
    return [
      booking.id,
      residentKeyFromData(booking),
      firstText(booking, [
        "bookingId",
        "bookingCode",
        "bookingNo",
        "bookingNumber"
      ]),
      firstText(booking, [
        "customerId",
        "customer_id",
        "residentId",
        "resident_id",
        "userId",
        "uid"
      ]),
      firstText(booking, [
        "customerPhone",
        "residentPhone",
        "phone",
        "mobile",
        "phoneNumber",
        "contact",
        "phoneDigits"
      ]),
      firstText(booking, [
        "customerName",
        "residentName",
        "guestName",
        "tenantName",
        "name",
        "fullName"
      ]),
      firstText(booking, ["email", "emailAddress"])
    ].filter(Boolean);
  }

  function shouldReplace(oldBooking, newBooking) {
    if (!oldBooking) return true;

    const oldActive = isActiveBooking(firstText(oldBooking, [
      "status",
      "bookingStatus",
      "stayStatus"
    ]));

    const newActive = isActiveBooking(firstText(newBooking, [
      "status",
      "bookingStatus",
      "stayStatus"
    ]));

    const oldDate = dateFromData(oldBooking, [
      "createdAt",
      "bookingDate",
      "checkIn"
    ]) || new Date(1900, 0, 1);

    const newDate = dateFromData(newBooking, [
      "createdAt",
      "bookingDate",
      "checkIn"
    ]) || new Date(1900, 0, 1);

    return (newActive && !oldActive) || newDate > oldDate;
  }

  state.bookings.forEach((booking) => {
    bookingLookupKeys(booking).forEach((key) => {
      const normalized = normalizeLookupKey(key);

      if (normalized && shouldReplace(bookingByResidentKey[normalized], booking)) {
        bookingByResidentKey[normalized] = booking;
      }

      const phoneKey = normalizePhoneKey(key);

      if (phoneKey && shouldReplace(bookingByResidentKey[phoneKey], booking)) {
        bookingByResidentKey[phoneKey] = booking;

        if (phoneKey.length === 10) {
          bookingByResidentKey[`91${phoneKey}`] = booking;
          bookingByResidentKey[`+91${phoneKey}`] = booking;
        }
      }
    });
  });

  return bookingByResidentKey;
}

function residentLookupKeys({ id, userData, bookingData }) {
  const user = userData || {};
  const booking = bookingData || {};

  return [
    id,
    booking.id,
    residentKeyFromData(user),
    residentKeyFromData(booking),
    firstText(user, ["customerId", "residentId", "userId", "uid"]),
    firstText(booking, ["customerId", "residentId", "userId", "uid"]),
    firstText(user, [
      "customerPhone",
      "residentPhone",
      "phone",
      "mobile",
      "phoneNumber",
      "contact",
      "phoneDigits"
    ]),
    firstText(booking, [
      "customerPhone",
      "residentPhone",
      "phone",
      "mobile",
      "phoneNumber",
      "contact",
      "phoneDigits"
    ]),
    firstText(user, ["email", "emailAddress"]),
    firstText(booking, ["email", "emailAddress"]),
    firstText(booking, [
      "bookingCode",
      "bookingId",
      "bookingNo",
      "bookingNumber"
    ])
  ].filter(Boolean);
}

function findByLookup(map, keys) {
  for (const key of keys) {
    const normalized = normalizeLookupKey(key);

    if (normalized && map[normalized]) return map[normalized];

    const phoneKey = normalizePhoneKey(key);

    if (phoneKey && map[phoneKey]) return map[phoneKey];

    if (phoneKey.length === 10) {
      if (map[`91${phoneKey}`]) return map[`91${phoneKey}`];
      if (map[`+91${phoneKey}`]) return map[`+91${phoneKey}`];
    }
  }

  return null;
}

function findBookingForPerson(bookingByResidentKey, id, userData) {
  return findByLookup(bookingByResidentKey, residentLookupKeys({
    id,
    userData
  }));
}

function findMoveOutForPerson(moveOutByKey, id, userData, bookingData) {
  return findByLookup(moveOutByKey, residentLookupKeys({
    id,
    userData,
    bookingData
  }));
}

function createResidentItem({
  id,
  userData,
  bookingData,
  propertyNames,
  roomNames,
  bedNames,
  extraOutstandingAmount,
  extraPaymentStatus,
  moveOutRequest
}) {
  const user = userData || {};
  const booking = bookingData || {};

  const name = firstNonEmpty([
    firstText(user, [
      "fullName",
      "name",
      "displayName",
      "residentName",
      "customerName",
      "tenantName"
    ]),
    firstText(booking, [
      "residentName",
      "customerName",
      "guestName",
      "tenantName",
      "name",
      "fullName"
    ]),
    "Resident"
  ]);

  const phone = firstNonEmpty([
    firstText(user, [
      "customerPhone",
      "residentPhone",
      "phone",
      "mobile",
      "phoneNumber",
      "contact",
      "phoneDigits"
    ]),
    firstText(booking, [
      "customerPhone",
      "residentPhone",
      "phone",
      "mobile",
      "phoneNumber",
      "contact",
      "phoneDigits"
    ])
  ]);

  const email = firstNonEmpty([
    firstText(user, ["email", "emailAddress"]),
    firstText(booking, ["email", "emailAddress"])
  ]);

  const imageUrl = firstNonEmpty([
    firstText(user, ["imageUrl", "photoUrl", "profileImage", "avatar"]),
    firstText(booking, ["imageUrl", "photoUrl", "profileImage", "avatar"])
  ]);

  const propertyId = firstNonEmpty([
    firstText(booking, [
      "propertyId",
      "property_id",
      "listingId",
      "listing_id",
      "currentPropertyId"
    ]),
    firstText(user, [
      "currentPropertyId",
      "propertyId",
      "property_id",
      "listingId",
      "listing_id"
    ])
  ]);

  const roomId = firstNonEmpty([
    firstText(booking, [
      "roomId",
      "room_id",
      "currentRoomId"
    ]),
    firstText(user, [
      "currentRoomId",
      "roomId",
      "room_id"
    ])
  ]);

  const bedId = firstNonEmpty([
    firstText(booking, [
      "bedId",
      "bed_id",
      "currentBedId"
    ]),
    firstText(user, [
      "currentBedId",
      "bedId",
      "bed_id"
    ])
  ]);

  const propertyName = firstNonEmpty([
    propertyNames[propertyId],
    firstText(booking, [
      "propertyName",
      "property",
      "buildingName",
      "listingName",
      "currentPropertyName"
    ]),
    firstText(user, [
      "currentPropertyName",
      "propertyName",
      "property",
      "buildingName"
    ]),
    "No Property Assigned"
  ]);

  const roomName = firstNonEmpty([
    roomNames[roomId],
    firstText(booking, [
      "roomName",
      "roomNumber",
      "roomNo",
      "room",
      "currentRoomName",
      "currentRoomNo"
    ]),
    firstText(user, [
      "currentRoomName",
      "currentRoomNo",
      "roomName",
      "roomNumber",
      "roomNo",
      "room"
    ])
  ]);

  const bedName = firstNonEmpty([
    bedNames[bedId],
    firstText(booking, [
      "bedName",
      "bedNumber",
      "bedNo",
      "bed",
      "currentBedName",
      "currentBedNo"
    ]),
    firstText(user, [
      "currentBedName",
      "currentBedNo",
      "bedName",
      "bedNumber",
      "bedNo",
      "bed"
    ])
  ]);

  const kycStatus = cleanLabel(firstNonEmpty([
    firstText(user, [
      "kycStatus",
      "kyc_status",
      "verificationStatus"
    ]),
    firstText(booking, [
      "kycStatus",
      "kyc_status",
      "verificationStatus"
    ]),
    "Pending"
  ]));

  const basePaymentStatus = cleanLabel(firstNonEmpty([
    extraPaymentStatus,
    firstText(booking, [
      "paymentStatus",
      "payment_status",
      "rentStatus",
      "billingStatus"
    ]),
    firstText(user, [
      "paymentStatus",
      "payment_status",
      "rentStatus",
      "billingStatus"
    ]),
    "Unknown"
  ]));

  const bookingStatus = firstText(booking, [
    "status",
    "bookingStatus",
    "stayStatus"
  ]);

  const checkInDate = dateFromData(booking, [
    "checkIn",
    "check_in",
    "checkInDate",
    "moveInDate",
    "startDate"
  ]) || dateFromData(user, [
    "checkIn",
    "check_in",
    "checkInDate",
    "moveInDate",
    "startDate"
  ]);

  const checkOutDate = dateFromData(booking, [
    "checkOut",
    "check_out",
    "checkOutDate",
    "moveOutDate",
    "endDate"
  ]) || dateFromData(user, [
    "checkOut",
    "check_out",
    "checkOutDate",
    "moveOutDate",
    "endDate"
  ]);

  const createdAt = dateFromData(user, [
    "createdAt",
    "created_at",
    "registeredAt"
  ]) || dateFromData(booking, [
    "createdAt",
    "created_at",
    "bookingDate"
  ]);

  const bookingMonthlyRent = numberFromData(booking, [
    "monthlyRent",
    "rent",
    "rentAmount",
    "price",
    "amount",
    "totalAmount",
    "bookingAmount"
  ]);

  const userMonthlyRent = numberFromData(user, [
    "monthlyRent",
    "rent",
    "rentAmount",
    "currentMonthlyRent",
    "currentRent"
  ]);

  const monthlyRent = bookingMonthlyRent > 0 ? bookingMonthlyRent : userMonthlyRent;

  const bookingOutstanding = numberFromData(booking, [
    "outstandingAmount",
    "dueAmount",
    "pendingAmount",
    "balanceAmount",
    "unpaidAmount"
  ]);

  const userOutstanding = numberFromData(user, [
    "outstandingAmount",
    "dueAmount",
    "pendingAmount",
    "balanceAmount",
    "unpaidAmount"
  ]);

  const outstandingAmount =
    extraOutstandingAmount > 0
      ? extraOutstandingAmount
      : bookingOutstanding > 0
      ? bookingOutstanding
      : userOutstanding;

  const finalStatus = residentStatus({
    bookingStatus,
    kycStatus,
    paymentStatus: basePaymentStatus,
    checkOutDate,
    outstandingAmount,
    moveOutRequest
  });

  const roomBed = roomBedLabel(roomName, bedName);

  return {
    id,
    residentCode: firstNonEmpty([
      firstText(user, ["residentCode", "residentId", "customerCode"]),
      firstText(booking, ["residentCode", "residentId", "customerCode"]),
      `RES-${String(id).slice(0, 6).toUpperCase()}`
    ]),
    name,
    phone,
    email,
    imageUrl,
    propertyId,
    propertyName,
    roomBed,
    kycStatus,
    paymentStatus: outstandingAmount > 0 ? "Due Payment" : basePaymentStatus,
    status: finalStatus,
    stayDuration: stayDuration(checkInDate),
    monthlyRent,
    outstandingAmount,
    checkInDate,
    checkOutDate,
    createdAt,
    moveOutRequest,
    hasMoveOutRequest: moveOutRequest?.isActive === true,
    moveOutStatusLabel: moveOutRequest?.statusLabel || "No Move-out Request",
    moveOutReason: moveOutRequest?.reason || "",
    hasPaymentDue:
      outstandingAmount > 0 ||
      normalize(basePaymentStatus).includes("due") ||
      normalize(basePaymentStatus).includes("pending") ||
      normalize(basePaymentStatus).includes("unpaid") ||
      normalize(basePaymentStatus).includes("partial"),
    get isVacatingSoon() {
      const plannedMoveOut = moveOutRequest?.plannedMoveOutDate;

      if (plannedMoveOut) return isWithinNextDays(plannedMoveOut, 30);

      return isWithinNextDays(checkOutDate, 30);
    }
  };
}

function buildResidents() {
  const { propertyNames, roomNames, bedNames } = buildMaps();
  const { outstandingByResidentKey, paymentStatusByResidentKey } = buildOutstandingData();
  const bookingByResidentKey = buildBookingMap();
  const moveOutByKey = buildMoveOutMap();

  const residents = [];
  const usedKeys = new Set();

  function markUsed(id, userData, bookingData) {
    residentLookupKeys({ id, userData, bookingData }).forEach((key) => {
      const normalized = normalizeLookupKey(key);

      if (normalized) usedKeys.add(normalized);

      const phoneKey = normalizePhoneKey(key);

      if (phoneKey) {
        usedKeys.add(phoneKey);

        if (phoneKey.length === 10) {
          usedKeys.add(`91${phoneKey}`);
          usedKeys.add(`+91${phoneKey}`);
        }
      }
    });
  }

  function alreadyUsed(id, userData, bookingData) {
    return residentLookupKeys({ id, userData, bookingData }).some((key) => {
      const normalized = normalizeLookupKey(key);

      if (normalized && usedKeys.has(normalized)) return true;

      const phoneKey = normalizePhoneKey(key);

      if (phoneKey && usedKeys.has(phoneKey)) return true;

      if (phoneKey.length === 10) {
        return usedKeys.has(`91${phoneKey}`) || usedKeys.has(`+91${phoneKey}`);
      }

      return false;
    });
  }

  function outstandingKeyFor(id, data, booking) {
    return firstNonEmpty([
      residentKeyFromData(data),
      residentKeyFromData(booking),
      firstText(data, [
        "customerPhone",
        "residentPhone",
        "phone",
        "mobile",
        "phoneDigits"
      ]),
      firstText(booking, [
        "customerPhone",
        "residentPhone",
        "phone",
        "mobile",
        "phoneDigits"
      ]),
      id
    ]);
  }

  function addResident({ id, userData, bookingData }) {
    if (alreadyUsed(id, userData, bookingData)) return;

    markUsed(id, userData, bookingData);

    const outKey = outstandingKeyFor(id, userData, bookingData);
    const phoneOutKey = normalizePhoneKey(outKey);
    const moveOutRequest = findMoveOutForPerson(moveOutByKey, id, userData, bookingData);

    residents.push(createResidentItem({
      id,
      userData,
      bookingData,
      propertyNames,
      roomNames,
      bedNames,
      extraOutstandingAmount:
        outstandingByResidentKey[outKey] ||
        outstandingByResidentKey[phoneOutKey] ||
        0,
      extraPaymentStatus:
        paymentStatusByResidentKey[outKey] ||
        paymentStatusByResidentKey[phoneOutKey] ||
        "",
      moveOutRequest
    }));
  }

  state.users.forEach((user) => {
    if (!isResidentUser(user)) return;

    const booking = findBookingForPerson(bookingByResidentKey, user.id, user);
    const role = normalize(firstText(user, ["role", "userRole", "type", "userType"]));
    const forceResident = ["resident", "tenant"].includes(role);

    if (!forceResident && !hasConfirmedResidentBooking(booking)) return;

    addResident({
      id: user.id,
      userData: user,
      bookingData: booking
    });
  });

  state.customers.forEach((customer) => {
    if (!isResidentUser(customer)) return;

    const booking = findBookingForPerson(bookingByResidentKey, customer.id, customer);

    if (!hasConfirmedResidentBooking(booking)) return;

    addResident({
      id: customer.id,
      userData: customer,
      bookingData: booking
    });
  });

  state.residentsRaw.forEach((resident) => {
    const booking = findBookingForPerson(bookingByResidentKey, resident.id, resident);

    addResident({
      id: resident.id,
      userData: resident,
      bookingData: booking
    });
  });

  state.bookings.forEach((booking) => {
    if (!hasConfirmedResidentBooking(booking)) return;

    const hasResidentName = firstText(booking, [
      "residentName",
      "customerName",
      "guestName",
      "tenantName",
      "name",
      "fullName"
    ]);

    const hasPhone = firstText(booking, [
      "customerPhone",
      "residentPhone",
      "phone",
      "mobile",
      "phoneDigits"
    ]);

    if (!hasResidentName && !hasPhone) return;

    addResident({
      id: booking.id,
      userData: {},
      bookingData: booking
    });
  });

  residents.sort((a, b) => {
    if (a.hasPaymentDue && !b.hasPaymentDue) return -1;
    if (!a.hasPaymentDue && b.hasPaymentDue) return 1;

    const aTime = a.checkInDate?.getTime() || 0;
    const bTime = b.checkInDate?.getTime() || 0;

    return bTime - aTime;
  });

  state.residentItems = residents;

  return residents;
}

function calculateStats() {
  const residents = buildResidents();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalResidents = residents.length;
  const activeResidents = residents.filter((item) => item.status === "Active").length;
  const pendingKyc = residents.filter((item) => !isVerifiedKyc(item.kycStatus)).length;
  const moveInsThisMonth = residents.filter((item) => item.checkInDate && item.checkInDate >= startOfMonth).length;
  const vacatingSoon = residents.filter((item) => item.hasMoveOutRequest || item.isVacatingSoon).length;
  const duePayments = residents.filter((item) => item.hasPaymentDue).length;
  const outstandingAmount = residents.reduce((sum, item) => sum + item.outstandingAmount, 0);
  const newResidentsThisMonth = residents.filter((item) => item.createdAt && item.createdAt >= startOfMonth).length;

  return {
    totalResidents,
    activeResidents,
    pendingKyc,
    moveInsThisMonth,
    vacatingSoon,
    duePayments,
    outstandingAmount,
    newResidentsThisMonth,
    residents
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

function groupAmount(items, getter) {
  const map = new Map();

  items.forEach((item) => {
    const label = cleanLabel(getter(item) || "Unknown");
    map.set(label, (map.get(label) || 0) + item.outstandingAmount);
  });

  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function chartColor(index) {
  return [
    COLORS.green,
    COLORS.gold,
    COLORS.burgundy,
    COLORS.navy,
    COLORS.purple,
    COLORS.orange
  ][index % 6];
}

function setupAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "../index.html";
      return;
    }

    const name = user.displayName || "Admin";
    const email = user.email || "admin@email.com";
    const userInitials = initials(name || email);

    setText("adminName", name);
    setText("dropdownAdminName", name);
    setText("dropdownAdminEmail", email);
    setText("adminAvatar", userInitials);
    setText("adminAvatarSmall", userInitials);
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
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
  const propertiesToggle = $("propertiesToggle");
  const propertiesDropdown = $("propertiesDropdown");

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
    propertiesDropdown?.classList.remove("active");
  });

  profileDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    profileDropdown?.classList.remove("show");
    propertiesDropdown?.classList.remove("active");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      profileDropdown?.classList.remove("show");
      propertiesDropdown?.classList.remove("active");
      closeProfileSheet();
      closeAgreementSheet();
    }
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
  listenCollection("users", COLLECTIONS.users);
  listenCollection("customers", COLLECTIONS.customers);
  listenCollection("residentsRaw", COLLECTIONS.residents);
  listenCollection("bookings", COLLECTIONS.bookings);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("rooms", COLLECTIONS.rooms);
  listenCollection("beds", COLLECTIONS.beds);
  listenCollection("invoices", COLLECTIONS.invoices);
  listenCollection("transactions", COLLECTIONS.transactions);
  listenCollection("payments", COLLECTIONS.payments);
  listenCollection("moveOuts", COLLECTIONS.moveOuts);
  listenCollection("moveOutSettlements", COLLECTIONS.moveOutSettlements);
}

function renderPage() {
  const stats = calculateStats();

  renderStats(stats);
  renderAnalytics(stats.residents);
  renderResidentList();
}

function renderStats(stats) {
  setText("heroTotalResidents", stats.totalResidents);
  setText("heroActiveResidents", stats.activeResidents);
  setText("heroDueResidents", stats.duePayments);

  setText("totalResidentsValue", stats.totalResidents);
  setText("activeResidentsValue", stats.activeResidents);
  setText("pendingKycValue", stats.pendingKyc);
  setText("moveInsValue", stats.moveInsThisMonth);
  setText("vacatingSoonValue", stats.vacatingSoon);
  setText("duePaymentsValue", shortMoney(stats.outstandingAmount));

  setText("totalResidentsSub", `${stats.newResidentsThisMonth} new this month`);
  setText("duePaymentsSub", `${stats.duePayments} residents`);
}

function createChart(id, config) {
  const canvas = $(id);

  if (!canvas || !window.Chart) return;

  if (state.charts[id]) {
    state.charts[id].destroy();
  }

  state.charts[id] = new Chart(canvas, config);
}

function renderAnalytics(residents) {
  const statusRows = groupCount(residents, (item) => item.status)
    .map(([label, count], index) => [label, count, chartColor(index)]);

  setText("statusChartTotal", residents.length);

  createChart("statusChart", {
    type: "doughnut",
    data: {
      labels: statusRows.length ? statusRows.map((item) => item[0]) : ["No Data"],
      datasets: [
        {
          data: statusRows.length ? statusRows.map((item) => item[1]) : [1],
          backgroundColor: statusRows.length ? statusRows.map((item) => item[2]) : [COLORS.soft],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });

  const legend = $("statusLegend");

  if (legend) {
    if (!statusRows.length) {
      legend.innerHTML = `
        <div class="legend-row">
          <span><i class="legend-dot" style="background:${COLORS.soft}"></i>No data</span>
          <strong>0</strong>
        </div>
      `;
    } else {
      legend.innerHTML = statusRows.map(([label, count, color]) => {
        const percent = residents.length ? Math.round((count / residents.length) * 100) : 0;

        return `
          <div class="legend-row">
            <span><i class="legend-dot" style="background:${color}"></i>${escapeHtml(label)}</span>
            <strong>${count} (${percent}%)</strong>
          </div>
        `;
      }).join("");
    }
  }

  renderBarList("kycBars", groupCount(residents, (item) => item.kycStatus), false);
  renderBarList("propertyBars", groupCount(residents, (item) => item.propertyName || "Unknown Property"), false);
  renderBarList("outstandingBars", groupAmount(residents, (item) => item.status), true);
}

function renderBarList(id, rows, isMoney) {
  const container = $(id);

  if (!container) return;

  const filteredRows = isMoney
    ? rows.filter((item) => item[1] > 0)
    : rows;

  if (!filteredRows.length) {
    container.innerHTML = `<div class="empty-state">No chart data yet.</div>`;
    return;
  }

  const max = Math.max(...filteredRows.map((item) => item[1]), 1);

  container.innerHTML = filteredRows.slice(0, 6).map(([label, value], index) => {
    const percent = Math.max(4, Math.round((value / max) * 100));
    const color = chartColor(index);

    return `
      <div class="bar-row">
        <label>${escapeHtml(label)}</label>
        <div class="bar-track">
          <div class="bar-fill" style="width:${percent}%;background:${color}"></div>
        </div>
        <strong>${isMoney ? shortMoney(value) : value}</strong>
      </div>
    `;
  }).join("");
}

function getFilteredResidents() {
  let residents = [...state.residentItems];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("residentSearchInput")?.value);
  const search = localSearch || globalSearch;
  const statusFilter = $("statusFilter")?.value || "All Status";

  if (search) {
    residents = residents.filter((resident) => {
      const haystack = [
        resident.name,
        resident.phone,
        resident.email,
        resident.propertyName,
        resident.roomBed,
        resident.residentCode,
        resident.status,
        resident.paymentStatus,
        resident.kycStatus,
        resident.moveOutStatusLabel,
        resident.moveOutReason
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (statusFilter !== "All Status") {
    residents = residents.filter((resident) => resident.status === statusFilter);
  }

  return residents;
}

function renderResidentList() {
  const list = $("residentList");

  if (!list) return;

  const residents = getFilteredResidents();
  const totalPages = Math.max(1, Math.ceil(residents.length / state.rowsPerPage));

  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const paginated = residents.slice(start, start + state.rowsPerPage);

  setText("directorySub", `Showing ${residents.length} resident profiles`);

  if (!paginated.length) {
    list.innerHTML = `
      <div class="empty-state">
        No residents found. Only admin-added residents and confirmed/paid booked customers are shown here.
      </div>
    `;

    setText("tableSummary", "Showing 0 residents");
    renderPagination(totalPages);
    return;
  }

  list.innerHTML = paginated.map((resident) => {
    const color = statusColor(resident.status);

    const avatar = resident.imageUrl
      ? `<img src="${escapeHtml(resident.imageUrl)}" alt="${escapeHtml(resident.name)}" class="resident-avatar" />`
      : `<div class="resident-avatar">${escapeHtml(initials(resident.name))}</div>`;

    return `
      <article class="resident-card">
        ${avatar}

        <div class="resident-main">
          <h4>${escapeHtml(resident.name)}</h4>
          <p>${escapeHtml(resident.residentCode)} • ${escapeHtml(resident.propertyName)}</p>

          <div class="info-pills">
            <span class="info-pill">
              <i class="fa-solid fa-bed"></i>
              ${escapeHtml(resident.roomBed)}
            </span>

            <span class="info-pill">
              <i class="fa-solid fa-id-card"></i>
              ${escapeHtml(resident.kycStatus)}
            </span>

            ${
              resident.hasPaymentDue
                ? `
                  <span class="info-pill">
                    <i class="fa-solid fa-indian-rupee-sign"></i>
                    ${money(resident.outstandingAmount)}
                  </span>
                `
                : ""
            }

            ${
              resident.hasMoveOutRequest
                ? `
                  <span class="info-pill moveout">
                    <i class="fa-solid fa-right-from-bracket"></i>
                    ${escapeHtml(resident.moveOutStatusLabel)}
                  </span>
                `
                : ""
            }
          </div>
        </div>

        <div class="resident-actions">
          <span class="status-chip" style="background:${color}16;color:${color}">
            ${escapeHtml(resident.status)}
          </span>

          <button class="action-btn" type="button" data-open-profile="${escapeHtml(resident.id)}" title="View Profile">
            <i class="fa-regular fa-eye"></i>
          </button>

          <button class="action-btn" type="button" data-send-reminder="${escapeHtml(resident.id)}" title="Send Reminder">
            <i class="fa-brands fa-whatsapp"></i>
          </button>

          <button class="action-btn" type="button" data-open-agreement="${escapeHtml(resident.id)}" title="Agreement">
            <i class="fa-regular fa-file-lines"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-open-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      const resident = state.residentItems.find((item) => item.id === button.dataset.openProfile);
      if (resident) openProfileSheet(resident);
    });
  });

  list.querySelectorAll("[data-send-reminder]").forEach((button) => {
    button.addEventListener("click", () => {
      const resident = state.residentItems.find((item) => item.id === button.dataset.sendReminder);
      if (resident) sendReminder(resident);
    });
  });

  list.querySelectorAll("[data-open-agreement]").forEach((button) => {
    button.addEventListener("click", () => {
      const resident = state.residentItems.find((item) => item.id === button.dataset.openAgreement);
      if (resident) openAgreementSheet(resident);
    });
  });

  setText(
    "tableSummary",
    `Showing ${start + 1} to ${start + paginated.length} of ${residents.length} residents`
  );

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = $("pagination");

  if (!container) return;

  container.innerHTML = "";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;
  prev.disabled = state.currentPage === 1;
  prev.addEventListener("click", () => {
    state.currentPage -= 1;
    renderResidentList();
  });

  container.appendChild(prev);

  for (let page = 1; page <= Math.min(totalPages, 7); page++) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = page;
    button.className = page === state.currentPage ? "active" : "";
    button.addEventListener("click", () => {
      state.currentPage = page;
      renderResidentList();
    });

    container.appendChild(button);
  }

  const next = document.createElement("button");
  next.type = "button";
  next.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
  next.disabled = state.currentPage === totalPages;
  next.addEventListener("click", () => {
    state.currentPage += 1;
    renderResidentList();
  });

  container.appendChild(next);
}

function infoRow(icon, title, value) {
  return `
    <div class="info-row">
      <i class="${icon}"></i>
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function moveOutLine(icon, label, value) {
  return `
    <div class="moveout-line">
      <i class="${icon}"></i>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "Not added")}</strong>
    </div>
  `;
}

function moveOutBlock(resident) {
  const request = resident.moveOutRequest;

  if (!request || !request.isActive) {
    return `
      <div class="moveout-card">
        <div class="moveout-head">
          <i class="fa-solid fa-right-from-bracket" style="color:${COLORS.gray}"></i>
          <div>
            <strong>No move-out request raised yet.</strong>
            <p>Customer has not requested move-out from app.</p>
          </div>
        </div>
      </div>
    `;
  }

  const status = request.statusLabel;
  const statusColorValue = moveOutStatusColor(status);
  const selectedDate = formatDate(request.plannedMoveOutDate);
  const canStaffApprove = status === "Request Raised";
  const canAdminApprove = status === "Approved by Staff" && request.staffApproved;
  const canApprove = request.canApproveOnSelectedDate;

  const approvalText = canApprove
    ? "Approval allowed now"
    : `Can approve on ${selectedDate}`;

  return `
    <div class="moveout-card has-request" style="border-color:${statusColorValue}22;background:${statusColorValue}10">
      <div class="moveout-head">
        <i class="fa-solid fa-right-from-bracket" style="color:${statusColorValue}"></i>
        <div>
          <strong style="color:${statusColorValue}">${escapeHtml(status)}</strong>
          <p>Move-out request status flow: Request Raised → Staff Approved → Admin Approved.</p>
        </div>
      </div>

      <div class="moveout-lines">
        ${moveOutLine("fa-solid fa-calendar", "Requested On", formatDate(request.requestedAt))}
        ${moveOutLine("fa-solid fa-calendar-check", "Selected Move-out Date", selectedDate)}
        ${moveOutLine("fa-solid fa-lock", "Approval", approvalText)}
        ${moveOutLine(
          "fa-solid fa-hourglass-half",
          "Settlement Eligible",
          request.settlementEligible
            ? "Eligible now"
            : `${formatDate(request.settlementEligibleAt)}${request.settlementRemainingDays > 0 ? ` • ${request.settlementRemainingDays} days left` : ""}`
        )}
        ${request.reason ? moveOutLine("fa-solid fa-note-sticky", "Reason", request.reason) : ""}
      </div>

      <div class="moveout-steps">
        <div class="moveout-step ${status === "Request Raised" ? "active" : "done"}">
          <i class="fa-solid fa-circle-check"></i>
          <span>Request Raised</span>
        </div>

        <div class="moveout-step ${request.staffApproved ? "done" : ""}">
          <i class="fa-solid ${request.staffApproved ? "fa-circle-check" : "fa-circle"}"></i>
          <span>Staff Approved</span>
        </div>

        <div class="moveout-step ${request.adminApproved ? "done" : ""}">
          <i class="fa-solid ${request.adminApproved ? "fa-circle-check" : "fa-circle"}"></i>
          <span>Admin Approved</span>
        </div>
      </div>

      ${
        canStaffApprove || canAdminApprove
          ? `
            <div class="moveout-actions">
              <button
                class="moveout-action-btn ${canAdminApprove ? "admin" : ""}"
                type="button"
                id="${canStaffApprove ? "approveMoveOutStaffBtn" : "approveMoveOutAdminBtn"}"
                ${canApprove ? "" : "disabled"}
              >
                <i class="fa-solid ${canApprove ? (canStaffApprove ? "fa-user-check" : "fa-user-shield") : "fa-lock"}"></i>
                ${
                  canApprove
                    ? canStaffApprove
                      ? "Approve by Staff"
                      : "Final Approve by Admin"
                    : `Approve on ${escapeHtml(selectedDate)}`
                }
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function openProfileSheet(resident) {
  const content = $("profileSheetContent");

  if (!content) return;

  const color = statusColor(resident.status);

  const avatar = resident.imageUrl
    ? `<img src="${escapeHtml(resident.imageUrl)}" alt="${escapeHtml(resident.name)}" class="resident-avatar" />`
    : `<div class="resident-avatar">${escapeHtml(initials(resident.name))}</div>`;

  content.innerHTML = `
    <div class="profile-head">
      ${avatar}

      <div>
        <h2>${escapeHtml(resident.name)}</h2>
        <p>${escapeHtml(resident.residentCode)}</p>
        <span class="status-chip" style="background:${color}16;color:${color}">
          ${escapeHtml(resident.status)}
        </span>
      </div>
    </div>

    <div class="profile-section">
      <h3>Personal Details</h3>
      ${infoRow("fa-solid fa-phone", "Phone", resident.phone || "Not added")}
      ${infoRow("fa-solid fa-envelope", "Email", resident.email || "Not added")}
      ${infoRow("fa-solid fa-id-card", "KYC Status", resident.kycStatus)}
    </div>

    <div class="profile-section">
      <h3>Stay Details</h3>
      ${infoRow("fa-solid fa-building", "Property", resident.propertyName)}
      ${infoRow("fa-solid fa-bed", "Room / Bed", resident.roomBed)}
      ${infoRow("fa-solid fa-calendar", "Check-in", formatDate(resident.checkInDate))}
      ${infoRow("fa-solid fa-right-from-bracket", "Check-out", formatDate(resident.checkOutDate))}
      ${infoRow("fa-solid fa-clock", "Stay Duration", resident.stayDuration)}
    </div>

    <div class="profile-section">
      <h3>Move Out Request</h3>
      ${moveOutBlock(resident)}
    </div>

    <div class="profile-section">
      <h3>Payment Details</h3>
      ${infoRow("fa-solid fa-indian-rupee-sign", "Monthly Rent", money(resident.monthlyRent))}
      ${infoRow("fa-solid fa-receipt", "Payment Status", resident.paymentStatus)}
      ${infoRow("fa-solid fa-wallet", "Outstanding", money(resident.outstandingAmount))}
    </div>

    <div class="profile-action-row">
      <button class="sheet-action" type="button" id="sheetReminderBtn">
        <i class="fa-brands fa-whatsapp"></i>
        Send Reminder
      </button>

      <button class="sheet-action" type="button" id="sheetAgreementBtn">
        <i class="fa-regular fa-file-lines"></i>
        Agreement
      </button>
    </div>
  `;

  $("sheetReminderBtn")?.addEventListener("click", () => sendReminder(resident));
  $("sheetAgreementBtn")?.addEventListener("click", () => openAgreementSheet(resident));
  $("approveMoveOutStaffBtn")?.addEventListener("click", () => approveMoveOutByStaff(resident));
  $("approveMoveOutAdminBtn")?.addEventListener("click", () => approveMoveOutByAdmin(resident));

  $("profileSheet").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeProfileSheet() {
  const sheet = $("profileSheet");

  if (!sheet) return;

  sheet.hidden = true;

  if ($("agreementSheet")?.hidden) {
    document.body.style.overflow = "";
  }
}

async function writeMoveOutEvent({
  action,
  title,
  message,
  request,
  status
}) {
  try {
    const user = auth.currentUser;

    const payload = {
      module: "move_out_settlement",
      type: "move_out_action",
      action,
      title,
      message,
      moveOutRequestId: request.moveOutDocId || request.id,
      settlementId: request.settlementDocId || request.id,
      sourceCollection: "admin_web_residents_section",
      sourceId: request.id,
      residentId: request.residentId || "",
      residentName: request.customerName || "",
      customerPhone: request.customerPhone || "",
      bookingId: request.bookingId || "",
      bookingCode: request.bookingCode || "",
      propertyId: request.propertyId || "",
      propertyName: request.propertyName || "",
      roomNo: request.roomNo || "",
      bedNo: request.bedNo || "",
      status,
      target: "staff_admin",
      targetRole: "staff",
      visibleToStaff: true,
      visibleToAdmin: true,
      read: false,
      isRead: false,
      createdById: user?.uid || "",
      createdByEmail: user?.email || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await Promise.all([
      setDoc(doc(collection(db, COLLECTIONS.notifications)), payload),
      setDoc(doc(collection(db, COLLECTIONS.activityLogs)), {
        ...payload,
        read: true,
        isRead: true,
        logType: "move_out_activity"
      })
    ]);
  } catch (error) {
    console.warn("Move-out event log failed:", error);
  }
}

async function approveMoveOutByStaff(resident) {
  const request = resident.moveOutRequest;

  if (!request) {
    toast(`No move-out request found for ${resident.name}.`, true);
    return;
  }

  if (!request.canApproveOnSelectedDate) {
    toast(
      `This request can be approved only on selected move-out date: ${formatDate(request.plannedMoveOutDate)}.`,
      true
    );
    return;
  }

  try {
    const moveOutDocId = request.moveOutDocId || request.id;
    const settlementDocId = request.settlementDocId || request.id;

    const updateData = {
      status: "approved_by_staff",
      requestStatus: "approved_by_staff",
      moveOutStatus: "approved_by_staff",
      settlementStatus: "approved_by_staff",
      staffApprovalStatus: "approved",
      staffApprovedAt: serverTimestamp(),
      showInAdminResidentSection: true,
      showInStaffMoveOutSettlement: true,
      visibleToAdmin: true,
      visibleToStaff: true,
      updatedAt: serverTimestamp()
    };

    await Promise.all([
      setDoc(doc(db, COLLECTIONS.moveOuts, moveOutDocId), updateData, {
        merge: true
      }),
      setDoc(doc(db, COLLECTIONS.moveOutSettlements, settlementDocId), {
        ...updateData,
        moveOutRequestId: moveOutDocId,
        settlementId: settlementDocId,
        bookingId: request.bookingId,
        bookingCode: request.bookingCode,
        customerName: request.customerName,
        residentName: request.customerName,
        customerPhone: request.customerPhone,
        residentPhone: request.customerPhone,
        phone: request.customerPhone,
        propertyId: request.propertyId,
        propertyName: request.propertyName,
        roomNo: request.roomNo,
        bedNo: request.bedNo,
        source: "admin_web_residents_section",
        sourceCollection: "move_out_settlements",
        createdAt: serverTimestamp()
      }, {
        merge: true
      })
    ]);

    await writeMoveOutEvent({
      action: "move_out_approved_by_staff",
      title: "Move-out Approved by Staff",
      message: `${resident.name} move-out request approved by staff/admin web.`,
      request,
      status: "Approved by Staff"
    });

    closeProfileSheet();
    toast("Move-out request approved by staff.");
  } catch (error) {
    console.error(error);
    toast(`Could not approve by staff: ${error.message}`, true);
  }
}

async function approveMoveOutByAdmin(resident) {
  const request = resident.moveOutRequest;

  if (!request) {
    toast(`No move-out request found for ${resident.name}.`, true);
    return;
  }

  if (!request.staffApproved) {
    toast("Staff approval is required before admin approval.", true);
    return;
  }

  if (!request.canApproveOnSelectedDate) {
    toast(
      `Admin approval will unlock on selected move-out date: ${formatDate(request.plannedMoveOutDate)}.`,
      true
    );
    return;
  }

  try {
    const moveOutDocId = request.moveOutDocId || request.id;
    const settlementDocId = request.settlementDocId || request.id;
    const eligible = request.settlementEligibleAt
      ? request.settlementEligibleAt <= new Date()
      : false;

    const updateData = {
      status: "approved_by_admin",
      requestStatus: "approved_by_admin",
      moveOutStatus: "approved_by_admin",
      adminApprovalStatus: "approved",
      finalApprovalStatus: "approved",
      adminApprovedAt: serverTimestamp(),
      canInitiateSettlement: eligible,
      settlementStatus: eligible ? "eligible_for_settlement" : "waiting_30_days",
      showInAdminResidentSection: true,
      showInStaffMoveOutSettlement: true,
      visibleToAdmin: true,
      visibleToStaff: true,
      updatedAt: serverTimestamp()
    };

    await Promise.all([
      setDoc(doc(db, COLLECTIONS.moveOuts, moveOutDocId), updateData, {
        merge: true
      }),
      setDoc(doc(db, COLLECTIONS.moveOutSettlements, settlementDocId), {
        ...updateData,
        moveOutRequestId: moveOutDocId,
        settlementId: settlementDocId,
        bookingId: request.bookingId,
        bookingCode: request.bookingCode,
        customerName: request.customerName,
        residentName: request.customerName,
        customerPhone: request.customerPhone,
        residentPhone: request.customerPhone,
        phone: request.customerPhone,
        propertyId: request.propertyId,
        propertyName: request.propertyName,
        roomNo: request.roomNo,
        bedNo: request.bedNo,
        source: "admin_web_residents_section",
        sourceCollection: "move_out_settlements",
        createdAt: serverTimestamp()
      }, {
        merge: true
      })
    ]);

    await writeMoveOutEvent({
      action: "move_out_approved_by_admin",
      title: "Move-out Approved by Admin",
      message: `${resident.name} move-out request approved by admin.`,
      request,
      status: "Approved by Admin"
    });

    closeProfileSheet();

    toast(
      eligible
        ? "Admin approved. Settlement can now be initiated."
        : "Admin approved. Settlement will be eligible after 30 days."
    );
  } catch (error) {
    console.error(error);
    toast(`Could not approve by admin: ${error.message}`, true);
  }
}

function openAgreementSheet(resident) {
  const content = $("agreementSheetContent");

  if (!content) return;

  const agreementDate = formatDate(new Date());

  content.innerHTML = `
    <h2 class="agreement-title">Stay Agreement</h2>
    <p class="agreement-sub">Lively Legacy Accommodations × ${escapeHtml(resident.name)}</p>

    <div class="agreement-grid">
      <div class="agreement-info">
        <span>Client Name</span>
        <strong>${escapeHtml(resident.name)}</strong>
      </div>

      <div class="agreement-info">
        <span>Phone</span>
        <strong>${escapeHtml(resident.phone || "Not added")}</strong>
      </div>

      <div class="agreement-info">
        <span>Property</span>
        <strong>${escapeHtml(resident.propertyName)}</strong>
      </div>

      <div class="agreement-info">
        <span>Room / Bed</span>
        <strong>${escapeHtml(resident.roomBed)}</strong>
      </div>

      <div class="agreement-info">
        <span>Monthly Rent</span>
        <strong>${money(resident.monthlyRent)}</strong>
      </div>

      <div class="agreement-info">
        <span>Outstanding</span>
        <strong>${money(resident.outstandingAmount)}</strong>
      </div>

      <div class="agreement-info">
        <span>Check-in</span>
        <strong>${formatDate(resident.checkInDate)}</strong>
      </div>

      <div class="agreement-info">
        <span>KYC</span>
        <strong>${escapeHtml(resident.kycStatus)}</strong>
      </div>
    </div>

    <p class="agreement-text">
      This Stay Agreement is made on ${escapeHtml(agreementDate)} between Lively Legacy Accommodations,
      hereinafter referred to as the Accommodation Provider, and ${escapeHtml(resident.name)},
      hereinafter referred to as the Resident / Client.
    </p>

    <p class="agreement-text">
      The Accommodation Provider agrees to provide stay accommodation to the Resident at
      ${escapeHtml(resident.propertyName)}. The assigned stay space is ${escapeHtml(resident.roomBed)}.
      The resident code for internal reference is ${escapeHtml(resident.residentCode)}.
    </p>

    <p class="agreement-text">
      The Resident agrees to pay the monthly rent of ${money(resident.monthlyRent)} on or before the due date
      communicated by Lively Legacy Accommodations. Any outstanding amount currently recorded is
      ${money(resident.outstandingAmount)}.
    </p>

    <p class="agreement-text">
      The stay starts from ${formatDate(resident.checkInDate)} and the expected check-out date is
      ${formatDate(resident.checkOutDate)}. The current stay duration is ${escapeHtml(resident.stayDuration)}.
      The Resident shall maintain cleanliness, follow property rules, respect other residents, and avoid damage
      to rooms, beds, fixtures, and shared facilities.
    </p>

    <div class="signature-box">
      Signatures<br><br>
      Accommodation Provider: Lively Legacy Accommodations<br><br>
      Resident / Client: ___________________________
    </div>
  `;

  $("agreementSheet").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeAgreementSheet() {
  const sheet = $("agreementSheet");

  if (!sheet) return;

  sheet.hidden = true;

  if ($("profileSheet")?.hidden) {
    document.body.style.overflow = "";
  }
}

function sendReminder(resident) {
  const phone = whatsappPhone(resident.phone);

  if (!phone) {
    toast(`Phone number is not available for ${resident.name}.`, true);
    return;
  }

  const uri = `https://wa.me/${phone}?text=${encodeURIComponent(paymentReminderMessage(resident))}`;
  window.open(uri, "_blank", "noopener,noreferrer");
}

function exportCsv() {
  const residents = getFilteredResidents();

  const rows = [
    [
      "Resident",
      "Resident ID",
      "Phone",
      "Email",
      "Property",
      "Room / Bed",
      "KYC",
      "Payment",
      "Status",
      "Monthly Rent",
      "Outstanding",
      "Check-in",
      "Check-out",
      "Stay Duration",
      "Move-out Status",
      "Selected Move-out Date"
    ],
    ...residents.map((resident) => [
      resident.name,
      resident.residentCode,
      resident.phone,
      resident.email,
      resident.propertyName,
      resident.roomBed,
      resident.kycStatus,
      resident.paymentStatus,
      resident.status,
      resident.monthlyRent,
      resident.outstandingAmount,
      formatDate(resident.checkInDate),
      formatDate(resident.checkOutDate),
      resident.stayDuration,
      resident.moveOutStatusLabel,
      formatDate(resident.moveOutRequest?.plannedMoveOutDate)
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
  link.download = "residents.csv";
  link.click();

  URL.revokeObjectURL(url);
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

function setupEvents() {
  ["globalSearchInput", "residentSearchInput", "statusFilter"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      state.currentPage = 1;
      renderResidentList();
    });

    $(id)?.addEventListener("change", () => {
      state.currentPage = 1;
      renderResidentList();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("residentSearchInput").value = "";
    $("statusFilter").value = "All Status";

    state.currentPage = 1;
    renderResidentList();
  });

  $("filterBtn")?.addEventListener("click", () => {
    $("filterSection")?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });

  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    toast("Residents refreshed.");
  });

  $("exportBtn")?.addEventListener("click", exportCsv);

  $("closeProfileSheet")?.addEventListener("click", closeProfileSheet);
  $("closeAgreementSheet")?.addEventListener("click", closeAgreementSheet);

  $("profileSheet")?.addEventListener("click", (event) => {
    if (event.target.id === "profileSheet") closeProfileSheet();
  });

  $("agreementSheet")?.addEventListener("click", (event) => {
    if (event.target.id === "agreementSheet") closeAgreementSheet();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});