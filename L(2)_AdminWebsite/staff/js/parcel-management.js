import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  users: "users",
  staff: "staff",
  staffLoginAccounts: "staff_login_accounts",
  properties: "properties",
  residents: "residents",
  parcels: "parcels",
  parcelRequests: "parcel_requests",
  residentParcelRequests: "resident_parcel_requests",
  parcelRequestsCamel: "parcelRequests",
  notifications: "notifications",
  activityLogs: "activity_logs"
};

const session = {
  uid: "",
  role: "Staff",
  name: "Staff",
  email: "",
  staffId: "",
  propertyId: ""
};

const state = {
  activeTab: "request",
  statusFilter: "all",
  search: "",
  showAll: false,
  selectedParcel: null,

  userData: null,
  staffRecord: null,
  loginRecord: null,
  propertyRecord: null,

  parcels: [],
  parcelRequests: [],
  residentParcelRequests: [],
  parcelRequestsCamel: [],
  residents: [],
  users: [],
  properties: [],
  notifications: [],
  activityLogs: [],

  readNotificationKeys: new Set(),
  loading: false
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const escapeHtml = (text) => String(text ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = value;
};

function firstText(values, fallback = "") {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return fallback;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
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

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
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

function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "Just now";

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return formatDateTime(date);
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "ST").trim();

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

function readKeysStorageKey() {
  return `staff_parcel_read_notifications_${session.uid || "guest"}`;
}

function loadReadNotificationKeys() {
  try {
    const raw = localStorage.getItem(readKeysStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    state.readNotificationKeys = new Set(Array.isArray(list) ? list : []);
  } catch (_) {
    state.readNotificationKeys = new Set();
  }
}

function saveReadNotificationKeys() {
  localStorage.setItem(
    readKeysStorageKey(),
    JSON.stringify(Array.from(state.readNotificationKeys))
  );
}

/* AUTH */

function setupAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const legacyStaffLogin = localStorage.getItem("loginType") === "staff";

      if (!legacyStaffLogin) {
        window.location.href = "../index.html";
        return;
      }

      session.uid = localStorage.getItem("loggedInUserUID") || localStorage.getItem("staffAccountId") || "";
      session.role = localStorage.getItem("loggedInUserRole") || localStorage.getItem("staffRole") || "Staff";
      session.name = localStorage.getItem("loggedInUserName") || localStorage.getItem("staffName") || "Staff";
      session.email = localStorage.getItem("loggedInUserEmail") || localStorage.getItem("staffEmail") || "";
      session.staffId = localStorage.getItem("loggedInStaffId") || "";
      session.propertyId = localStorage.getItem("staffPropertyId") || "";

      if (!session.uid) {
        window.location.href = "../index.html";
        return;
      }

      await initData();
      return;
    }

    session.uid = user.uid;
    session.email = (user.email || "").trim().toLowerCase();
    session.name = user.displayName || localStorage.getItem("loggedInUserName") || "Staff";
    session.role = localStorage.getItem("loggedInUserRole") || "Staff";
    session.staffId = localStorage.getItem("loggedInStaffId") || "";
    session.propertyId = localStorage.getItem("staffPropertyId") || "";

    localStorage.setItem("loginType", "staff");
    localStorage.setItem("loggedInUserUID", session.uid);
    localStorage.setItem("loggedInUserEmail", session.email);
    localStorage.setItem("loggedInUserName", session.name);

    await initData();
  });
}

async function logout() {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch (_) {}

  localStorage.clear();
  window.location.href = "../index.html";
}

/* LAYOUT */

function setupLayout() {
  const staffApp = $("staffApp");
  const sidebar = $("staffSidebar");
  const overlay = $("mobileOverlay");
  const menuBtn = $("menuBtn");

  if (localStorage.getItem("staffSidebarCollapsed") === "true") {
    staffApp?.classList.add("sidebar-collapsed");
  }

  menuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.innerWidth <= 920) {
      sidebar?.classList.toggle("open");
      overlay?.classList.toggle("show");
    } else {
      staffApp?.classList.toggle("sidebar-collapsed");

      localStorage.setItem(
        "staffSidebarCollapsed",
        staffApp?.classList.contains("sidebar-collapsed") ? "true" : "false"
      );
    }
  });

  overlay?.addEventListener("click", () => {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("show");
  });

  $("logoutBtn")?.addEventListener("click", logout);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      sidebar?.classList.remove("open");
      overlay?.classList.remove("show");
    }
  });
}

/* DATA LOAD */

async function initData() {
  try {
    renderProfileShell();
    loadReadNotificationKeys();

    await loadUserData();
    await loadLoginRecord();
    await loadStaffRecord();
    await loadPropertyRecord();

    renderProfileShell();
    subscribeCollections();
  } catch (error) {
    console.error("Parcel page init failed:", error);
    showToast(`Parcel page failed: ${error.message}`, "error");
  }
}

async function safeGetDoc(collectionName, id) {
  if (!id) return null;

  try {
    const snap = await getDoc(doc(db, collectionName, id));

    if (!snap.exists()) return null;

    return {
      id: snap.id,
      ...snap.data()
    };
  } catch (error) {
    console.warn(`${collectionName}/${id} fetch failed:`, error);
    return null;
  }
}

async function getFirstQueryDoc(collectionName, field, value) {
  if (!value) return null;

  try {
    const q = query(collection(db, collectionName), where(field, "==", value), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    return {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data()
    };
  } catch (error) {
    console.warn(`${collectionName} query failed:`, field, error);
    return null;
  }
}

async function loadUserData() {
  state.userData = await safeGetDoc(COLLECTIONS.users, session.uid);

  if (state.userData) {
    session.name = firstText([
      state.userData.staffName,
      state.userData.name,
      state.userData.fullName,
      state.userData.displayName,
      session.name
    ], "Staff");

    session.email = firstText([
      state.userData.email,
      session.email
    ], "");

    session.staffId = firstText([
      state.userData.staffId,
      state.userData.employeeId,
      session.staffId
    ], "");

    session.propertyId = firstText([
      state.userData.propertyId,
      state.userData.assignedPropertyId,
      state.userData.property_id,
      session.propertyId
    ], "");
  }
}

async function loadLoginRecord() {
  state.loginRecord = await safeGetDoc(COLLECTIONS.staffLoginAccounts, session.uid);

  if (!state.loginRecord) {
    const searches = [
      [COLLECTIONS.staffLoginAccounts, "uid", session.uid],
      [COLLECTIONS.staffLoginAccounts, "userId", session.uid],
      [COLLECTIONS.staffLoginAccounts, "email", session.email],
      [COLLECTIONS.staffLoginAccounts, "username", session.email],
      [COLLECTIONS.staffLoginAccounts, "staffEmail", session.email],
      [COLLECTIONS.staffLoginAccounts, "staffId", session.staffId]
    ];

    for (const [collectionName, field, value] of searches) {
      const record = await getFirstQueryDoc(collectionName, field, value);
      if (record) {
        state.loginRecord = record;
        break;
      }
    }
  }

  if (state.loginRecord) {
    session.name = firstText([
      state.loginRecord.staffName,
      state.loginRecord.name,
      state.loginRecord.fullName,
      session.name
    ], "Staff");

    session.staffId = firstText([
      state.loginRecord.staffId,
      state.loginRecord.employeeId,
      session.staffId
    ], "");

    session.propertyId = firstText([
      state.loginRecord.propertyId,
      state.loginRecord.property_id,
      session.propertyId
    ], "");
  }
}

async function loadStaffRecord() {
  const linkedEmployeeId = firstText([
    state.loginRecord?.employeeId,
    state.loginRecord?.employeeUid,
    state.userData?.employeeId,
    state.userData?.employeeUid
  ], "");

  state.staffRecord =
    await safeGetDoc(COLLECTIONS.staff, linkedEmployeeId) ||
    await safeGetDoc(COLLECTIONS.staff, session.uid);

  if (!state.staffRecord) {
    const searches = [
      [COLLECTIONS.staff, "uid", session.uid],
      [COLLECTIONS.staff, "userId", session.uid],
      [COLLECTIONS.staff, "email", session.email],
      [COLLECTIONS.staff, "staffEmail", session.email],
      [COLLECTIONS.staff, "staffId", session.staffId]
    ];

    for (const [collectionName, field, value] of searches) {
      const record = await getFirstQueryDoc(collectionName, field, value);
      if (record) {
        state.staffRecord = record;
        break;
      }
    }
  }

  if (state.staffRecord) {
    session.name = getStaffName();
    session.staffId = getStaffId();
    session.propertyId = getPropertyId();
  }
}

async function loadPropertyRecord() {
  const propertyId = getPropertyId();
  const propertyName = firstText([
    state.loginRecord?.propertyName,
    state.loginRecord?.property,
    state.staffRecord?.propertyName,
    state.staffRecord?.property,
    state.userData?.propertyName,
    state.userData?.property
  ], "");

  state.propertyRecord =
    await safeGetDoc(COLLECTIONS.properties, propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyId", propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyCode", propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyName", propertyName) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "name", propertyName);
}

/* PROFILE */

function getStaffName() {
  return firstText([
    state.staffRecord?.staffName,
    state.staffRecord?.name,
    state.staffRecord?.fullName,
    state.staffRecord?.employeeName,
    state.loginRecord?.staffName,
    state.loginRecord?.name,
    state.loginRecord?.fullName,
    state.userData?.staffName,
    state.userData?.name,
    state.userData?.fullName,
    session.name
  ], "Staff");
}

function getStaffId() {
  return firstText([
    state.staffRecord?.staffId,
    state.staffRecord?.employeeId,
    state.staffRecord?.staffCode,
    state.loginRecord?.staffId,
    state.loginRecord?.employeeId,
    state.userData?.staffId,
    session.staffId,
    session.uid
  ], session.uid);
}

function getPropertyId() {
  return firstText([
    state.staffRecord?.propertyId,
    state.staffRecord?.assignedPropertyId,
    state.staffRecord?.propertyDocId,
    state.staffRecord?.property_id,
    state.loginRecord?.propertyId,
    state.loginRecord?.assignedPropertyId,
    state.loginRecord?.property_id,
    state.userData?.propertyId,
    state.userData?.assignedPropertyId,
    state.userData?.property_id,
    session.propertyId
  ], "");
}

function getPropertyName() {
  return firstText([
    state.propertyRecord?.propertyName,
    state.propertyRecord?.name,
    state.propertyRecord?.title,
    state.loginRecord?.propertyName,
    state.loginRecord?.property,
    state.staffRecord?.propertyName,
    state.staffRecord?.property,
    state.userData?.propertyName,
    state.userData?.property
  ], "Assigned Property");
}

function renderProfileShell() {
  const staffName = getStaffName();
  const email = session.email || "staff@email.com";
  const initials = getInitials(staffName || email);

  setText("staffNameTop", staffName);
  setText("staffEmailTop", email);
  setText("staffAvatarText", initials);
  setText("topPropertyText", getPropertyName() || "Staff panel");
}

/* PARCEL HELPERS */

function residentOptions() {
  const list = [];

  state.residents.forEach((item) => {
    const propertyId = firstText([item.propertyId, item.property_id], "");
    list.push({
      id: item.id,
      name: firstText([item.name, item.fullName, item.residentName], item.id),
      phone: firstText([item.phone, item.mobile, item.phoneNumber], ""),
      email: firstText([item.email], ""),
      roomNo: firstText([item.roomNo, item.roomNumber, item.bedNo, item.room, item.bed], ""),
      propertyId,
      propertyName: firstText([item.propertyName, item.property, getPropertyNameById(propertyId)], "")
    });
  });

  state.users.forEach((item) => {
    if (list.some((resident) => resident.id === item.id)) return;

    const role = normalize(firstText([item.role, item.userRole, item.type], ""));
    const looksResident = !role || role === "resident" || role === "tenant" || role === "student";

    if (!looksResident) return;

    const propertyId = firstText([item.propertyId, item.property_id], "");

    list.push({
      id: item.id,
      name: firstText([item.name, item.fullName, item.displayName], item.id),
      phone: firstText([item.phone, item.mobile, item.phoneNumber], ""),
      email: firstText([item.email], ""),
      roomNo: firstText([item.roomNo, item.roomNumber, item.bedNo, item.room, item.bed], ""),
      propertyId,
      propertyName: firstText([item.propertyName, item.property, getPropertyNameById(propertyId)], "")
    });
  });

  return list;
}

function getPropertyNameById(id) {
  const key = String(id || "");
  if (!key) return "";

  const property = state.properties.find((item) => {
    return (
      String(item.id || "") === key ||
      String(item.propertyId || "") === key ||
      String(item.propertyCode || "") === key
    );
  });

  return firstText([property?.propertyName, property?.name, property?.title], "");
}

function getResident(parcel) {
  const residentId = firstText([
    parcel.residentId,
    parcel.userId,
    parcel.residentUID,
    parcel.residentUid,
    parcel.requestedById,
    parcel.createdById,
    parcel.userUid,
    parcel.uid,
    parcel.receiverId,
    parcel.hostResidentId
  ], "");

  if (!residentId) return null;

  return residentOptions().find((resident) => resident.id === residentId) || null;
}

function getResidentName(parcel) {
  const resident = getResident(parcel);

  return firstText([
    parcel.residentName,
    parcel.receiverName,
    parcel.hostName,
    parcel.name,
    parcel.fullName,
    parcel.requestedByName,
    parcel.userName,
    resident?.name
  ], "Resident");
}

function getResidentPhone(parcel) {
  const resident = getResident(parcel);

  return firstText([
    parcel.residentPhone,
    parcel.phone,
    parcel.mobile,
    parcel.phoneNumber,
    parcel.contact,
    parcel.mobileNumber,
    resident?.phone
  ], "-");
}

function getResidentEmail(parcel) {
  const resident = getResident(parcel);

  return firstText([
    parcel.residentEmail,
    parcel.email,
    resident?.email
  ], "");
}

function getResidentRoom(parcel) {
  const resident = getResident(parcel);

  return firstText([
    parcel.roomNo,
    parcel.roomNumber,
    parcel.bedNo,
    parcel.room,
    parcel.bed,
    resident?.roomNo
  ], "");
}

function getParcelPropertyId(parcel) {
  const resident = getResident(parcel);

  return firstText([
    parcel.propertyId,
    parcel.property_id,
    parcel.propertyID,
    parcel.hostelId,
    parcel.buildingId,
    resident?.propertyId
  ], "");
}

function getParcelPropertyName(parcel) {
  const propertyId = getParcelPropertyId(parcel);
  const resident = getResident(parcel);

  return firstText([
    parcel.propertyName,
    parcel.property,
    getPropertyNameById(propertyId),
    resident?.propertyName,
    "No Property"
  ], "No Property");
}

function getCourierName(parcel) {
  return firstText([
    parcel.courierName,
    parcel.courier,
    parcel.deliveryPartner,
    parcel.deliveryBy,
    parcel.deliveryCompany,
    parcel.vendor,
    parcel.source
  ], "Delivery Partner");
}

function getParcelType(parcel) {
  return firstText([
    parcel.parcelType,
    parcel.type,
    parcel.requestType,
    parcel.itemType
  ], "Parcel");
}

function getTrackingId(parcel) {
  return firstText([
    parcel.trackingId,
    parcel.trackingNo,
    parcel.parcelNo,
    parcel.referenceId,
    parcel.referenceNo,
    parcel.awbNo,
    parcel.awbNumber,
    parcel.parcelCode,
    parcel.code,
    parcel.id
  ], parcel.id || "-");
}

function getNotes(parcel) {
  return firstText([
    parcel.notes,
    parcel.message,
    parcel.description,
    parcel.remarks,
    parcel.additionalRemarks,
    parcel.note
  ], "");
}

function rawParcelStatus(parcel) {
  return firstText([
    parcel.staffDisplayStatus,
    parcel.status,
    parcel.parcelStatus,
    parcel.requestStatus,
    parcel.handoverStatus
  ], "Requested");
}

function normalizeParcelStatus(value) {
  const clean = normalize(value);

  if (
    clean === "requested" ||
    clean === "request" ||
    clean === "pending" ||
    clean === "new" ||
    clean === "submitted" ||
    clean === "raised" ||
    clean === "open"
  ) {
    return "Requested";
  }

  if (
    clean === "collected by staff" ||
    clean === "collected_by_staff" ||
    clean === "collected" ||
    clean === "checked" ||
    clean === "checked and collected" ||
    clean === "checked_collected" ||
    clean === "received by staff" ||
    clean === "received_by_staff" ||
    clean === "received" ||
    clean === "in transit" ||
    clean === "in-transit"
  ) {
    return "Collected by Staff";
  }

  if (
    clean === "ready for pickup" ||
    clean === "ready_for_pickup" ||
    clean === "ready"
  ) {
    return "Ready for Pickup";
  }

  if (
    clean === "handed over to resident" ||
    clean === "handed_over_to_resident" ||
    clean === "handed_over" ||
    clean === "handed-over" ||
    clean === "handed" ||
    clean === "delivered" ||
    clean === "handover completed" ||
    clean === "received by resident"
  ) {
    return "Handed Over to Resident";
  }

  if (clean === "returned") return "Returned";
  if (clean === "cancelled" || clean === "canceled") return "Cancelled";

  return "Requested";
}

function parcelStatus(parcel) {
  return normalizeParcelStatus(rawParcelStatus(parcel));
}

function isRequestReceived(parcel) {
  return parcelStatus(parcel) === "Requested";
}

function isHandledOver(parcel) {
  return parcelStatus(parcel) === "Handed Over to Resident";
}

function isTransit(parcel) {
  const status = parcelStatus(parcel);
  return status === "Collected by Staff" || status === "Ready for Pickup";
}

function isReturnedOrCancelled(parcel) {
  const status = parcelStatus(parcel);
  return status === "Returned" || status === "Cancelled";
}

function statusLabel(status) {
  const clean = normalizeParcelStatus(status);

  if (clean === "Requested") return "Pending";
  if (clean === "Collected by Staff") return "In Transit";
  if (clean === "Ready for Pickup") return "Pending";
  if (clean === "Handed Over to Resident") return "Handed";
  if (clean === "Returned") return "Returned";
  if (clean === "Cancelled") return "Cancelled";

  return clean;
}

function statusClass(status) {
  const clean = normalizeParcelStatus(status);

  if (clean === "Requested") return "requested";
  if (clean === "Collected by Staff") return "transit";
  if (clean === "Ready for Pickup") return "ready";
  if (clean === "Handed Over to Resident") return "handed";
  if (clean === "Returned") return "returned";
  if (clean === "Cancelled") return "cancelled";

  return "requested";
}

function parcelDate(parcel) {
  return (
    toDate(parcel.cancelledAt || parcel.canceledAt) ||
    toDate(parcel.handedOverAt || parcel.deliveredAt || parcel.handoverCompletedAt) ||
    toDate(parcel.returnedAt) ||
    toDate(parcel.readyForPickupAt) ||
    toDate(parcel.receivedAt || parcel.receivedByStaffAt || parcel.collectedAt) ||
    toDate(parcel.requestedAt || parcel.requestedOn || parcel.submittedAt) ||
    toDate(parcel.createdAt) ||
    new Date(1900, 0, 1)
  );
}

function belongsToStaffProperty(parcel) {
  const propertyId = getPropertyId();
  const propertyName = getPropertyName();

  if (!propertyId && !propertyName) return true;

  const parcelPropertyId = getParcelPropertyId(parcel);
  const parcelPropertyName = getParcelPropertyName(parcel);

  return (
    !parcelPropertyId && !parcelPropertyName ||
    (propertyId && parcelPropertyId === propertyId) ||
    (propertyName && parcelPropertyName === propertyName)
  );
}

function parcelFromSource(item, sourceCollection) {
  return {
    ...item,
    collection: sourceCollection
  };
}

function allParcelRecords() {
  const raw = [
    ...state.parcels.map((item) => parcelFromSource(item, COLLECTIONS.parcels)),
    ...state.parcelRequests.map((item) => parcelFromSource(item, COLLECTIONS.parcelRequests)),
    ...state.residentParcelRequests.map((item) => parcelFromSource(item, COLLECTIONS.residentParcelRequests)),
    ...state.parcelRequestsCamel.map((item) => parcelFromSource(item, COLLECTIONS.parcelRequestsCamel))
  ].filter(belongsToStaffProperty);

  const seen = new Set();
  const list = [];

  raw.forEach((parcel) => {
    const tracking = getTrackingId(parcel).trim().toLowerCase();
    const residentId = firstText([
      parcel.residentId,
      parcel.userId,
      parcel.residentUID,
      parcel.residentUid,
      parcel.requestedById,
      parcel.createdById,
      parcel.userUid,
      parcel.uid
    ], "").trim().toLowerCase();

    const key = tracking && tracking !== "-"
      ? `${tracking}_${residentId}`
      : `${parcel.collection}_${parcel.id}`;

    if (!seen.has(key)) {
      seen.add(key);
      list.push(parcel);
    }
  });

  list.sort((a, b) => parcelDate(b).getTime() - parcelDate(a).getTime());

  return list;
}

function searchedParcels(records) {
  const text = normalize(state.search);

  if (!text) return records;

  return records.filter((parcel) => {
    return [
      getResidentName(parcel),
      getResidentPhone(parcel),
      getResidentRoom(parcel),
      getCourierName(parcel),
      getTrackingId(parcel),
      getNotes(parcel),
      parcelStatus(parcel)
    ].some((value) => normalize(value).includes(text));
  });
}

function filteredMainParcels() {
  let records = allParcelRecords();

  if (state.activeTab === "request") {
    records = records.filter(isRequestReceived);
  }

  if (state.activeTab === "handled") {
    records = records.filter(isHandledOver);
  }

  if (state.activeTab === "transit") {
    records = records.filter(isTransit);
  }

  if (state.activeTab === "returned") {
    records = records.filter(isReturnedOrCancelled);
  }

  if (state.statusFilter !== "all") {
    records = records.filter((parcel) => parcelStatus(parcel) === state.statusFilter);
  }

  return searchedParcels(records);
}

/* RENDER */

function renderPage() {
  renderProfileShell();
  renderStats();
  renderMainTable();
  renderHandedTable();
  renderNotifications();
}

function renderStats() {
  const records = allParcelRecords();
  const request = records.filter(isRequestReceived);
  const handled = records.filter(isHandledOver);
  const transit = records.filter(isTransit);
  const returned = records.filter(isReturnedOrCancelled);

  setText("requestReceivedCount", twoDigits(request.length));
  setText("handedOverCount", twoDigits(handled.length));
  setText("pendingCount", twoDigits(transit.length));
  setText("returnedCount", twoDigits(returned.length));

  setText("requestTabCount", `(${request.length})`);
  setText("handedTabCount", `(${handled.length})`);
  setText("transitTabCount", `(${transit.length})`);
  setText("returnedTabCount", `(${returned.length})`);
  setText("handedSectionCount", `(${handled.length})`);
}

function renderMainHeader() {
  const map = {
    request: {
      title: "Request Received",
      subtitle: "Parcels requested by residents and waiting for staff action."
    },
    handled: {
      title: "Handed Over",
      subtitle: "Parcels successfully handed over to residents."
    },
    transit: {
      title: "In Transit / Pending",
      subtitle: "Parcels collected by staff or ready for pickup."
    },
    returned: {
      title: "Returned / Cancelled",
      subtitle: "Parcels marked returned or cancelled."
    }
  };

  setText("mainSectionTitle", map[state.activeTab]?.title || "Parcels");
  setText("mainSectionSubtitle", map[state.activeTab]?.subtitle || "");
}

function parcelRow(parcel, index) {
  const date = parcelDate(parcel);
  const status = parcelStatus(parcel);
  const room = getResidentRoom(parcel);
  const roomText = room ? room : "-";
  const notes = getNotes(parcel) || "No additional note";

  const canMarkHanded = !isHandledOver(parcel) && !isReturnedOrCancelled(parcel);

  return `
    <tr>
      <td>${index + 1}</td>

      <td>
        <strong>${escapeHtml(formatDate(date))}</strong>
        <span>${escapeHtml(formatTime(date))}</span>
      </td>

      <td>
        <strong>${escapeHtml(getResidentName(parcel))}</strong>
        <span>${escapeHtml(roomText)}, ${escapeHtml(getResidentPhone(parcel))}</span>
      </td>

      <td>${escapeHtml(getCourierName(parcel))}</td>

      <td>
        ${escapeHtml(getTrackingId(parcel))}
        <i class="fa-regular fa-copy copy-icon" data-copy="${escapeHtml(getTrackingId(parcel))}"></i>
      </td>

      <td>${escapeHtml(notes)}</td>

      <td>
        <span class="status-badge ${statusClass(status)}">
          ${escapeHtml(statusLabel(status))}
        </span>
      </td>

      <td>
        ${canMarkHanded ? `
          <button type="button" class="mark-btn" data-action="status" data-status="Handed Over to Resident" data-id="${escapeHtml(parcel.id)}" data-collection="${escapeHtml(parcel.collection)}">
            Mark Handed
          </button>
        ` : `
          <button type="button" class="detail-btn" data-action="details" data-id="${escapeHtml(parcel.id)}" data-collection="${escapeHtml(parcel.collection)}">
            Details
          </button>
        `}

        <button type="button" class="more-select" data-action="details" data-id="${escapeHtml(parcel.id)}" data-collection="${escapeHtml(parcel.collection)}">
          <i class="fa-solid fa-chevron-down"></i>
        </button>
      </td>
    </tr>
  `;
}

function renderMainTable() {
  renderMainHeader();

  const tbody = $("parcelTableBody");
  if (!tbody) return;

  const records = filteredMainParcels();
  const visible = state.showAll ? records : records.slice(0, 8);

  if (!records.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-table">No parcels found.</td>
      </tr>
    `;

    const toggle = $("toggleViewAllBtn");
    if (toggle) toggle.hidden = true;
    return;
  }

  tbody.innerHTML = visible.map(parcelRow).join("");

  const toggle = $("toggleViewAllBtn");
  if (toggle) {
    toggle.hidden = records.length <= 8;
    toggle.innerHTML = state.showAll
      ? `Show Less <i class="fa-solid fa-arrow-up"></i>`
      : `View All <i class="fa-solid fa-arrow-right"></i>`;
  }
}

function handedRow(parcel, index) {
  const date = toDate(parcel.handedOverAt || parcel.deliveredAt || parcel.handoverCompletedAt) || parcelDate(parcel);
  const room = getResidentRoom(parcel);
  const roomText = room ? room : "-";
  const handedTo = firstText([
    parcel.handedOverToName,
    parcel.handedOverTo,
    parcel.receiverName,
    parcel.residentName,
    getResidentName(parcel)
  ], "-");

  return `
    <tr>
      <td>${index + 1}</td>

      <td>
        <strong>${escapeHtml(formatDate(date))}</strong>
        <span>${escapeHtml(formatTime(date))}</span>
      </td>

      <td>
        <strong>${escapeHtml(getResidentName(parcel))}</strong>
        <span>${escapeHtml(roomText)}, ${escapeHtml(getResidentPhone(parcel))}</span>
      </td>

      <td>${escapeHtml(getCourierName(parcel))}</td>

      <td>
        ${escapeHtml(getTrackingId(parcel))}
        <i class="fa-regular fa-copy copy-icon" data-copy="${escapeHtml(getTrackingId(parcel))}"></i>
      </td>

      <td>${escapeHtml(handedTo)}</td>

      <td>${escapeHtml(getNotes(parcel) || "No additional note")}</td>

      <td>
        <button type="button" class="detail-btn" data-action="details" data-id="${escapeHtml(parcel.id)}" data-collection="${escapeHtml(parcel.collection)}">
          View Details
        </button>
      </td>
    </tr>
  `;
}

function renderHandedTable() {
  const tbody = $("handedOverTable");
  if (!tbody) return;

  const records = searchedParcels(allParcelRecords().filter(isHandledOver)).slice(0, 8);

  if (!records.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-table">No handed over parcels found.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map(handedRow).join("");
}

/* DETAILS MODAL */

function findParcel(id, collectionName) {
  return allParcelRecords().find((parcel) => {
    return parcel.id === id && parcel.collection === collectionName;
  });
}

function openParcelDetails(parcel) {
  if (!parcel) {
    showToast("Parcel not found.", "error");
    return;
  }

  state.selectedParcel = parcel;

  setText("detailTrackingId", getTrackingId(parcel));
  setText("detailStatusText", statusLabel(parcelStatus(parcel)));
  setText("detailNotes", getNotes(parcel) || "No additional note.");

  const grid = $("parcelDetailGrid");
  if (grid) {
    const date = parcelDate(parcel);

    const lines = [
      ["Resident", getResidentName(parcel)],
      ["Room / Bed", getResidentRoom(parcel) || "-"],
      ["Phone", getResidentPhone(parcel)],
      ["Email", getResidentEmail(parcel) || "-"],
      ["Delivery By", getCourierName(parcel)],
      ["Tracking ID", getTrackingId(parcel)],
      ["Parcel Type", getParcelType(parcel)],
      ["Property", getParcelPropertyName(parcel)],
      ["Status", parcelStatus(parcel)],
      ["Date & Time", formatDateTime(date)]
    ];

    grid.innerHTML = lines.map(([label, value]) => `
      <div class="detail-line">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("");
  }

  openModal("parcelDetailModal");
}

/* NOTIFICATIONS */

function isParcelNotification(item) {
  const text = [
    item.module,
    item.type,
    item.action,
    item.title,
    item.message,
    item.trackingId,
    item.logType
  ].join(" ").toLowerCase();

  return (
    text.includes("parcel") ||
    text.includes("tracking") ||
    text.includes("handover") ||
    text.includes("handed")
  );
}

function rawNotifications() {
  const records = [
    ...state.notifications.map((item) => ({ ...item, collection: COLLECTIONS.notifications })),
    ...state.activityLogs.map((item) => ({ ...item, collection: COLLECTIONS.activityLogs }))
  ];

  return records
    .filter((item) => isParcelNotification(item))
    .map((item) => ({
      readKey: `${item.collection}_${item.id}`,
      title: firstText([item.title], "Parcel Activity"),
      message: firstText([item.message], "Parcel update received."),
      trackingId: firstText([item.trackingId], ""),
      createdAt: toDate(item.createdAt || item.updatedAt)
    }))
    .sort((a, b) => {
      return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
    });
}

function visibleNotifications() {
  return rawNotifications().filter((item) => !state.readNotificationKeys.has(item.readKey));
}

function renderNotifications() {
  const notifications = visibleNotifications();

  setText("notificationCount", notifications.length > 99 ? "99+" : notifications.length);

  const list = $("notificationList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<div class="empty-table">No unread parcel notifications.</div>`;
    return;
  }

  list.innerHTML = notifications.slice(0, 40).map((item) => {
    return `
      <div class="notification-item">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.message)}</p>
        ${item.trackingId ? `<p>Tracking: ${escapeHtml(item.trackingId)}</p>` : ""}
        <small>${escapeHtml(timeAgo(item.createdAt))}</small>
      </div>
    `;
  }).join("");
}

function markNotificationsRead() {
  visibleNotifications().forEach((item) => {
    if (item.readKey) {
      state.readNotificationKeys.add(item.readKey);
    }
  });

  saveReadNotificationKeys();
  renderNotifications();
  showToast("Notifications marked as read.");
}

/* FIRESTORE ACTIONS */

function actionFromStatus(status) {
  const clean = normalize(status);

  if (clean.includes("collected") || clean.includes("received")) return "parcel_in_transit";
  if (clean.includes("ready")) return "parcel_pending";
  if (clean.includes("handed")) return "parcel_handed_over";
  if (clean.includes("returned")) return "parcel_returned";
  if (clean.includes("cancel")) return "parcel_cancelled";
  if (clean.includes("requested")) return "parcel_requested";

  return "parcel_status_updated";
}

function titleFromStatus(status) {
  const clean = normalize(status);

  if (clean.includes("collected") || clean.includes("received")) return "Parcel In Transit";
  if (clean.includes("ready")) return "Parcel Pending";
  if (clean.includes("handed")) return "Parcel Handed Over";
  if (clean.includes("returned")) return "Parcel Returned";
  if (clean.includes("cancel")) return "Parcel Cancelled";
  if (clean.includes("requested")) return "Parcel Requested";

  return "Parcel Status Updated";
}

async function writeParcelEvent(parcel, status) {
  const now = serverTimestamp();

  const payload = {
    module: "parcels",
    type: "parcel_action",
    action: actionFromStatus(status),
    title: titleFromStatus(status),
    message: `${getTrackingId(parcel)} for ${getResidentName(parcel)} marked as ${status}.`,
    parcelId: parcel.id,
    trackingId: getTrackingId(parcel),
    residentId: firstText([
      parcel.residentId,
      parcel.userId,
      parcel.residentUID,
      parcel.residentUid,
      parcel.requestedById,
      parcel.createdById,
      parcel.userUid,
      parcel.uid
    ], ""),
    residentName: getResidentName(parcel),
    propertyId: getParcelPropertyId(parcel),
    propertyName: getParcelPropertyName(parcel),
    status,
    target: "staff",
    targetRole: "staff",
    visibleToStaff: true,
    visibleToAdmin: true,
    read: false,
    isRead: false,
    createdById: session.uid,
    createdByEmail: session.email,
    createdAt: now,
    updatedAt: now
  };

  const batch = writeBatch(db);

  batch.set(doc(collection(db, COLLECTIONS.notifications)), payload);
  batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
    ...payload,
    read: true,
    isRead: true,
    logType: "parcel_activity"
  });

  await batch.commit();
}

function statusUpdatePayload(parcel, status) {
  const now = serverTimestamp();
  const staffName = firstText([getStaffName(), session.email, "Staff"], "Staff");

  const data = {
    status,
    parcelStatus: status,
    staffDisplayStatus: status,
    updatedAt: now,
    lastActionByStaffId: session.uid,
    lastActionByStaffEmail: session.email,
    lastActionByStaffName: staffName
  };

  if (status === "Requested") {
    data.requestedAt = now;
  }

  if (status === "Collected by Staff" || status === "Received by Staff") {
    data.status = "Collected by Staff";
    data.parcelStatus = "Collected by Staff";
    data.staffDisplayStatus = "Collected by Staff";
    data.receivedByStaffAt = now;
    data.receivedAt = now;
    data.collectedAt = now;
    data.receivedByStaffId = session.uid;
    data.receivedByStaffEmail = session.email;
    data.receivedByStaffName = staffName;
    data.collectedByStaffId = session.uid;
    data.collectedByStaffName = staffName;
  }

  if (status === "Ready for Pickup") {
    data.readyForPickupAt = now;
    data.readyByStaffId = session.uid;
    data.readyByStaffName = staffName;
  }

  if (status === "Handed Over to Resident") {
    data.handedOverAt = now;
    data.deliveredAt = now;
    data.handoverCompletedAt = now;
    data.handedOverByStaffId = session.uid;
    data.handedOverByStaffEmail = session.email;
    data.handedOverByStaffName = staffName;
    data.handedOverToName = getResidentName(parcel);
  }

  if (status === "Returned") {
    data.returnedAt = now;
    data.returnedByStaffId = session.uid;
    data.returnedByStaffName = staffName;
  }

  if (status === "Cancelled") {
    data.cancelledAt = now;
    data.cancelledByStaffId = session.uid;
    data.cancelledByStaffName = staffName;
  }

  return data;
}

function mirrorParcelPayload(parcel, data) {
  return {
    parcelId: parcel.id,
    trackingId: getTrackingId(parcel),
    residentId: firstText([
      parcel.residentId,
      parcel.userId,
      parcel.residentUID,
      parcel.residentUid,
      parcel.requestedById,
      parcel.createdById,
      parcel.userUid,
      parcel.uid
    ], ""),
    residentName: getResidentName(parcel),
    residentPhone: getResidentPhone(parcel),
    residentEmail: getResidentEmail(parcel),
    roomNo: getResidentRoom(parcel),
    propertyId: getParcelPropertyId(parcel),
    propertyName: getParcelPropertyName(parcel),
    courierName: getCourierName(parcel),
    parcelType: getParcelType(parcel),
    source: parcel.source || "resident_request",
    sourceCollection: parcel.collection,
    sourceDocId: parcel.id,
    notes: getNotes(parcel),
    createdAt: parcel.createdAt || parcel.requestedAt || serverTimestamp(),
    ...data
  };
}

async function updateParcelStatus(parcel, status) {
  if (!parcel || state.loading) return;

  state.loading = true;

  try {
    const data = statusUpdatePayload(parcel, status);

    await setDoc(
      doc(db, parcel.collection, parcel.id),
      data,
      { merge: true }
    );

    if (parcel.collection !== COLLECTIONS.parcels) {
      await setDoc(
        doc(db, COLLECTIONS.parcels, parcel.id),
        mirrorParcelPayload(parcel, data),
        { merge: true }
      );
    }

    await writeParcelEvent(parcel, data.status || status);

    showToast(`${getResidentName(parcel)} marked as ${data.status || status}.`);
    closeModal("parcelDetailModal");
  } catch (error) {
    console.error("Parcel update failed:", error);
    showToast(`Failed to update parcel: ${error.message}`, "error");
  } finally {
    state.loading = false;
  }
}

/* SUBSCRIPTIONS */

let subscriptionsStarted = false;

function subscribeCollection(stateKey, collectionName) {
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
      showToast(`${collectionName} fetch failed. Check Firestore rules.`, "error");
    }
  );
}

function subscribeCollections() {
  if (subscriptionsStarted) return;
  subscriptionsStarted = true;

  subscribeCollection("parcels", COLLECTIONS.parcels);
  subscribeCollection("parcelRequests", COLLECTIONS.parcelRequests);
  subscribeCollection("residentParcelRequests", COLLECTIONS.residentParcelRequests);
  subscribeCollection("parcelRequestsCamel", COLLECTIONS.parcelRequestsCamel);
  subscribeCollection("residents", COLLECTIONS.residents);
  subscribeCollection("users", COLLECTIONS.users);
  subscribeCollection("properties", COLLECTIONS.properties);
  subscribeCollection("notifications", COLLECTIONS.notifications);
  subscribeCollection("activityLogs", COLLECTIONS.activityLogs);
}

/* CLOCK */

function setupClock() {
  function updateDateTime() {
    const now = new Date();

    setText("todayDate", now.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }));

    setText("currentTime", now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }));
  }

  updateDateTime();
  setInterval(updateDateTime, 1000);
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

/* EVENTS */

function setupTabs() {
  document.querySelectorAll(".section-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".section-tab").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      state.activeTab = button.dataset.tab || "request";
      state.showAll = false;
      state.statusFilter = "all";

      const select = $("parcelStatusFilter");
      if (select) select.value = "all";

      renderMainTable();
    });
  });
}

function setupEvents() {
  setupTabs();

  $("parcelSearchInput")?.addEventListener("input", (event) => {
    state.search = event.target.value || "";
    renderMainTable();
    renderHandedTable();
  });

  $("clearSearchBtn")?.addEventListener("click", () => {
    state.search = "";
    const input = $("parcelSearchInput");
    if (input) input.value = "";
    renderMainTable();
    renderHandedTable();
  });

  $("parcelStatusFilter")?.addEventListener("change", (event) => {
    state.statusFilter = event.target.value || "all";
    renderMainTable();
  });

  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Parcel data refreshed.");
  });

  $("toggleViewAllBtn")?.addEventListener("click", () => {
    state.showAll = !state.showAll;
    renderMainTable();
  });

  $("notificationBtn")?.addEventListener("click", () => {
    renderNotifications();
    openModal("notificationModal");
  });

  $("markNotificationsReadBtn")?.addEventListener("click", markNotificationsRead);

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  document.addEventListener("click", async (event) => {
    const copyIcon = event.target.closest("[data-copy]");

    if (copyIcon) {
      const value = copyIcon.dataset.copy || "";

      try {
        await navigator.clipboard.writeText(value);
        showToast("Tracking ID copied.");
      } catch (_) {
        showToast(value);
      }

      return;
    }

    const button = event.target.closest("[data-action]");

    if (!button) return;

    const action = button.dataset.action;
    const parcelId = button.dataset.id;
    const collectionName = button.dataset.collection;

    const parcel = findParcel(parcelId, collectionName);

    if (!parcel) {
      showToast("Parcel not found.", "error");
      return;
    }

    if (action === "details") {
      openParcelDetails(parcel);
      return;
    }

    if (action === "status") {
      const status = button.dataset.status || "Handed Over to Resident";
      button.disabled = true;

      try {
        await updateParcelStatus(parcel, status);
      } finally {
        button.disabled = false;
      }
    }
  });

  document.querySelectorAll("[data-modal-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!state.selectedParcel) {
        showToast("Parcel not selected.", "error");
        return;
      }

      button.disabled = true;

      try {
        await updateParcelStatus(state.selectedParcel, button.dataset.modalStatus);
      } finally {
        button.disabled = false;
      }
    });
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupClock();
  setupLayout();
  setupEvents();
  setupAuth();
});