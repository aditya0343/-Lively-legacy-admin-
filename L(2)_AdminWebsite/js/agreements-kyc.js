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
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  agreements: "agreements",
  stayAgreements: "stay_agreements",
  kycDocuments: "kyc_documents",
  residents: "residents",
  users: "users",
  properties: "properties"
};

const AGREEMENT_STATUSES = [
  "Active",
  "Accepted",
  "Expiring Soon",
  "Expired",
  "Terminated"
];

const AGREEMENT_TYPES = [
  "Digital Stay Agreement",
  "Leave & License",
  "Rental Agreement",
  "PG Agreement",
  "Service Agreement",
  "Other"
];

const KYC_STATUSES = ["Verified", "Pending", "Incomplete"];

const COLORS = {
  navy: "#061b32",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  orange: "#e18a00",
  purple: "#6352c7",
  blue: "#2f80ed"
};

const state = {
  activeTab: "agreements",
  agreements: [],
  stayAgreements: [],
  kycDocuments: [],
  residents: [],
  users: [],
  properties: [],
  savingAgreement: false,
  unsubscribers: []
};

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
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

function titleCase(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";

  return clean
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

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
  const num = Number(value || 0);
  if (!num) return "-";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(num);
}

function dateInputValue(date = new Date()) {
  const parsed = toDate(date) || new Date();
  return parsed.toISOString().slice(0, 10);
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

function valueText(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function numberValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (typeof value === "number" && Number.isFinite(value)) return value;

    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

function dateValue(data, keys) {
  for (const key of keys) {
    const date = toDate(data?.[key]);
    if (date) return date;
  }

  return null;
}

function fileText(value) {
  if (!value) return "";

  if (typeof value === "string") return value.trim();

  if (typeof value === "object") {
    return firstNonEmpty([
      value.dataUri,
      value.imageBase64,
      value.base64,
      value.url,
      value.downloadUrl,
      value.fileUrl,
      value.path
    ]);
  }

  return "";
}

function nestedFileText(data, parentKey, childKey) {
  const parent = data?.[parentKey];

  if (!parent || typeof parent !== "object") return "";

  return fileText(parent[childKey]);
}

function normalizeAgreementType(value) {
  const clean = String(value || "").trim();
  if (!clean) return "Leave & License";

  const lower = clean.toLowerCase();

  if (lower === "digital stay agreement") return "Digital Stay Agreement";
  if (lower === "leave & license" || lower === "leave and license") return "Leave & License";
  if (lower === "rental agreement") return "Rental Agreement";
  if (lower === "pg agreement") return "PG Agreement";
  if (lower === "service agreement") return "Service Agreement";
  if (lower === "other") return "Other";

  return titleCase(clean);
}

function normalizeAgreementStatus(value, endDate, accepted = false) {
  if (accepted) return "Accepted";

  const clean = normalize(value).replaceAll("_", " ").replaceAll("-", " ");
  const parsedEnd = toDate(endDate);

  if (clean === "terminated") return "Terminated";

  if (parsedEnd && parsedEnd < new Date()) return "Expired";

  if (clean === "expired") return "Expired";
  if (clean === "expiring soon") return "Expiring Soon";
  if (clean === "accepted") return "Accepted";
  if (clean === "active" || clean === "approved") return "Active";

  return "Active";
}

function normalizeKycStatus(value) {
  const clean = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (clean === "verified" || clean === "approved" || clean === "active") return "Verified";
  if (clean === "incomplete" || clean === "missing" || clean === "rejected") return "Incomplete";
  if (clean === "pending" || clean === "under verification") return "Pending";

  return "Pending";
}

function normalizeKycStatusWithDocs(value, aadhaarFront, aadhaarBack, panUrl, photoUrl) {
  const normalized = normalizeKycStatus(value);

  if (normalized === "Verified") return "Verified";

  const hasAnyDoc = Boolean(aadhaarFront || aadhaarBack || panUrl || photoUrl);

  if (!hasAnyDoc) return "Incomplete";

  return normalized;
}

function statusClass(value) {
  return normalize(value).replaceAll("&", "").replaceAll("/", "").replaceAll(" ", "-");
}

function agreementStatusRank(status) {
  const clean = normalize(status);

  if (clean === "accepted") return 1;
  if (clean === "active") return 2;
  if (clean === "expiring soon") return 3;
  if (clean === "expired") return 4;
  if (clean === "terminated") return 5;

  return 6;
}

function kycStatusRank(status) {
  const clean = normalize(status);

  if (clean === "pending") return 1;
  if (clean === "incomplete") return 2;
  if (clean === "verified") return 3;

  return 4;
}

function statusColor(status) {
  const clean = normalize(status);

  if (clean === "accepted") return COLORS.green;
  if (clean === "active") return COLORS.green;
  if (clean === "expiring soon") return COLORS.orange;
  if (clean === "expired") return COLORS.red;
  if (clean === "terminated") return COLORS.red;

  return COLORS.navy;
}

function kycStatusColor(status) {
  const clean = normalize(status);

  if (clean === "verified") return COLORS.green;
  if (clean === "pending") return COLORS.orange;
  if (clean === "incomplete") return COLORS.red;

  return COLORS.navy;
}

function agreementTypeColor(value) {
  const clean = normalize(value);

  if (clean.includes("digital")) return COLORS.green;
  if (clean.includes("rental")) return COLORS.blue;
  if (clean.includes("license")) return COLORS.green;
  if (clean.includes("pg")) return COLORS.orange;
  if (clean.includes("service")) return COLORS.purple;

  return COLORS.gold;
}

function documentColor(value) {
  const clean = normalize(value);

  if (clean.includes("front")) return COLORS.blue;
  if (clean.includes("back")) return COLORS.purple;
  if (clean.includes("pan")) return COLORS.green;
  if (clean.includes("photo")) return COLORS.orange;

  return COLORS.gold;
}

function propertyColor(value) {
  const hash = String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const colors = [COLORS.blue, COLORS.green, COLORS.orange, COLORS.purple, COLORS.red, COLORS.gold];
  return colors[hash % colors.length];
}

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
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      profileDropdown?.classList.remove("show");
    }
  });
}

function listenCollection(stateKey, collectionName) {
  const unsubscribe = onSnapshot(
    collection(db, collectionName),
    (snapshot) => {
      state[stateKey] = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        sourceCollection: collectionName,
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
  listenCollection("agreements", COLLECTIONS.agreements);
  listenCollection("stayAgreements", COLLECTIONS.stayAgreements);
  listenCollection("kycDocuments", COLLECTIONS.kycDocuments);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("properties", COLLECTIONS.properties);
}

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
      map.set(normalizeLookupKey(key), { id: property.id, name });
    });
  });

  return map;
}

function findProperty(id) {
  return getPropertyOptions().find((property) => property.id === id) || null;
}

function findPropertyNameFromMap(propertyMap, key) {
  if (!key) return "";

  return propertyMap.get(String(key))?.name ||
    propertyMap.get(normalizeLookupKey(key))?.name ||
    "";
}

function isResidentRole(data) {
  const role = normalize(valueText(data, ["role", "userRole", "type", "userType"]));

  if (["admin", "super_admin", "staff", "manager", "owner"].includes(role)) return false;

  if (role === "" || ["resident", "tenant", "student", "customer", "user"].includes(role)) {
    return true;
  }

  return false;
}

function getResidentKeys(item) {
  return [
    item.id,
    item.residentId,
    item.userId,
    item.uid,
    item.customerId,
    item.customerPhone,
    item.phone,
    item.mobile,
    item.phoneDigits,
    item.name,
    item.fullName,
    item.residentName,
    item.customerName
  ].filter(Boolean);
}

function addResidentLookup(map, item) {
  getResidentKeys(item).forEach((key) => {
    const normalized = normalizeLookupKey(key);
    if (normalized) map.set(normalized, item);

    const phone = normalizePhoneKey(key);
    if (phone) {
      map.set(phone, item);
      if (phone.length === 10) {
        map.set(`91${phone}`, item);
        map.set(`+91${phone}`, item);
      }
    }
  });
}

function getResidentOptions() {
  const propertyMap = getPropertyMap();
  const map = new Map();

  function addResident(source) {
    const propertyId = firstNonEmpty([
      source.propertyId,
      source.property_id,
      source.currentPropertyId
    ]);

    const name = firstNonEmpty([
      source.name,
      source.fullName,
      source.displayName,
      source.residentName,
      source.customerName,
      source.id
    ]);

    const phone = firstNonEmpty([
      source.phone,
      source.mobile,
      source.customerPhone,
      source.residentPhone,
      source.phoneDigits
    ]);

    const resident = {
      id: source.id,
      name,
      phone,
      email: firstNonEmpty([source.email, source.emailAddress]),
      roomNo: firstNonEmpty([
        source.roomNo,
        source.roomNumber,
        source.bedNo,
        source.unit,
        source.currentRoomNo,
        source.currentBedNo
      ]),
      propertyId,
      propertyName: firstNonEmpty([
        source.propertyName,
        source.property,
        source.currentPropertyName,
        findPropertyNameFromMap(propertyMap, propertyId),
        "No Property"
      ]),
      kycStatus: normalizeKycStatus(
        firstNonEmpty([
          source.kycStatus,
          source.verificationStatus,
          source.isKycVerified === true ? "Verified" : "",
          source.kycVerified === true ? "Verified" : "",
          "Pending"
        ])
      )
    };

    if (!resident.name && !resident.phone) return;

    map.set(resident.id, resident);
  }

  state.residents.forEach(addResident);

  state.users.forEach((user) => {
    if (map.has(user.id)) return;
    if (!isResidentRole(user)) return;
    addResident(user);
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getResidentLookupMap() {
  const map = new Map();

  getResidentOptions().forEach((resident) => {
    addResidentLookup(map, resident);
  });

  return map;
}

function findResidentByKeys(keys) {
  const map = getResidentLookupMap();

  for (const key of keys) {
    const normalized = normalizeLookupKey(key);
    if (normalized && map.has(normalized)) return map.get(normalized);

    const phone = normalizePhoneKey(key);
    if (phone && map.has(phone)) return map.get(phone);

    if (phone.length === 10) {
      if (map.has(`91${phone}`)) return map.get(`91${phone}`);
      if (map.has(`+91${phone}`)) return map.get(`+91${phone}`);
    }
  }

  return null;
}

function findResident(id) {
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

function createKycDocumentRecord(docItem) {
  const aadhaarFront = firstNonEmpty([
    nestedFileText(docItem, "aadhaarCard", "front"),
    fileText(docItem.aadhaarCardFront),
    fileText(docItem.aadhaarFront),
    fileText(docItem.aadhaar),
    valueText(docItem, ["aadhaarUrl", "aadhaarFrontUrl", "idProofUrl"])
  ]);

  const aadhaarBack = firstNonEmpty([
    nestedFileText(docItem, "aadhaarCard", "back"),
    fileText(docItem.aadhaarCardBack),
    fileText(docItem.aadhaarBack),
    valueText(docItem, ["aadhaarBackUrl"])
  ]);

  const pan = firstNonEmpty([
    fileText(docItem.panCard),
    fileText(docItem.pan),
    valueText(docItem, ["panUrl", "panCardUrl"])
  ]);

  const photo = firstNonEmpty([
    fileText(docItem.photo),
    fileText(docItem.profilePhoto),
    fileText(docItem.selfie),
    valueText(docItem, ["photoUrl", "profilePhotoUrl", "selfieUrl"])
  ]);

  const status = normalizeKycStatus(
    firstNonEmpty([
      valueText(docItem, ["kycStatus", "status", "verificationStatus"]),
      docItem.isVerified === true ? "Verified" : "",
      "Pending"
    ])
  );

  return {
    id: docItem.id,
    residentId: valueText(docItem, ["residentId", "userId", "customerId"]),
    customerPhone: valueText(docItem, ["customerPhone", "phone", "mobile"]),
    phoneDigits: valueText(docItem, ["phoneDigits"]),
    customerName: valueText(docItem, ["customerName", "residentName", "name"]),
    propertyId: valueText(docItem, ["propertyId", "property_id"]),
    propertyName: valueText(docItem, ["propertyName", "property"]),
    roomNo: valueText(docItem, ["roomNo", "roomNumber", "bedNo", "unit"]),
    kycStatus: status,
    aadhaarUrl: aadhaarFront,
    aadhaarBackUrl: aadhaarBack,
    panUrl: pan,
    photoUrl: photo,
    agreementUrl: valueText(docItem, ["agreementUrl", "agreementDocumentUrl"]),
    verifiedAt: dateValue(docItem, ["verifiedAt", "kycVerifiedAt"]),
    createdAt: dateValue(docItem, ["createdAt", "updatedAt"]),
    matchKeys: [
      docItem.id,
      valueText(docItem, ["residentId", "userId", "customerId"]),
      valueText(docItem, ["customerPhone", "phone", "mobile"]),
      valueText(docItem, ["phoneDigits"]),
      valueText(docItem, ["customerName", "residentName", "name"])
    ].filter(Boolean)
  };
}

function getKycDocumentMap() {
  const map = new Map();

  state.kycDocuments.forEach((raw) => {
    const item = createKycDocumentRecord(raw);

    item.matchKeys.forEach((key) => {
      const normalized = normalizeLookupKey(key);
      if (normalized) map.set(normalized, item);

      const phone = normalizePhoneKey(key);
      if (phone) {
        map.set(phone, item);
        if (phone.length === 10) {
          map.set(`91${phone}`, item);
          map.set(`+91${phone}`, item);
        }
      }
    });
  });

  return map;
}

function findKycForResident(resident, kycMap) {
  const keys = [
    resident.id,
    resident.phone,
    resident.name
  ].filter(Boolean);

  for (const key of keys) {
    const normalized = normalizeLookupKey(key);
    if (normalized && kycMap.has(normalized)) return kycMap.get(normalized);

    const phone = normalizePhoneKey(key);
    if (phone && kycMap.has(phone)) return kycMap.get(phone);

    if (phone.length === 10) {
      if (kycMap.has(`91${phone}`)) return kycMap.get(`91${phone}`);
      if (kycMap.has(`+91${phone}`)) return kycMap.get(`+91${phone}`);
    }
  }

  return null;
}

function getKycResidents() {
  const propertyMap = getPropertyMap();
  const kycMap = getKycDocumentMap();
  const residentMap = new Map();

  getResidentOptions().forEach((resident) => {
    const kyc = findKycForResident(resident, kycMap);

    const rawSource = [
      ...state.residents,
      ...state.users
    ].find((item) => item.id === resident.id) || {};

    const aadhaarFront = firstNonEmpty([
      kyc?.aadhaarUrl,
      nestedFileText(rawSource, "aadhaarCard", "front"),
      fileText(rawSource.aadhaarCardFront),
      valueText(rawSource, ["aadhaarUrl", "aadhaarFrontUrl", "idProofUrl"])
    ]);

    const aadhaarBack = firstNonEmpty([
      kyc?.aadhaarBackUrl,
      nestedFileText(rawSource, "aadhaarCard", "back"),
      fileText(rawSource.aadhaarCardBack),
      valueText(rawSource, ["aadhaarBackUrl"])
    ]);

    const pan = firstNonEmpty([
      kyc?.panUrl,
      fileText(rawSource.panCard),
      valueText(rawSource, ["panUrl", "panCardUrl"])
    ]);

    const photo = firstNonEmpty([
      kyc?.photoUrl,
      fileText(rawSource.photo),
      valueText(rawSource, ["photoUrl", "profilePhotoUrl", "selfieUrl"])
    ]);

    const agreement = firstNonEmpty([
      kyc?.agreementUrl,
      valueText(rawSource, ["agreementUrl", "agreementDocumentUrl"])
    ]);

    const rawStatus = firstNonEmpty([
      kyc?.kycStatus,
      rawSource.kycStatus,
      rawSource.isKycVerified === true ? "Verified" : "",
      rawSource.kycVerified === true ? "Verified" : "",
      "Pending"
    ]);

    residentMap.set(resident.id, {
      ...resident,
      propertyId: firstNonEmpty([resident.propertyId, kyc?.propertyId]),
      propertyName: firstNonEmpty([
        resident.propertyName,
        kyc?.propertyName,
        findPropertyNameFromMap(propertyMap, resident.propertyId),
        "No Property"
      ]),
      roomNo: firstNonEmpty([resident.roomNo, kyc?.roomNo]),
      kycDocId: kyc?.id || "",
      aadhaarUrl: aadhaarFront,
      aadhaarBackUrl: aadhaarBack,
      panUrl: pan,
      photoUrl: photo,
      agreementUrl: agreement,
      kycStatus: normalizeKycStatusWithDocs(rawStatus, aadhaarFront, aadhaarBack, pan, photo),
      lastVerifiedAt: kyc?.verifiedAt || dateValue(rawSource, ["verifiedAt", "kycVerifiedAt"])
    });
  });

  state.kycDocuments.forEach((raw) => {
    const kyc = createKycDocumentRecord(raw);

    const alreadyShown = Array.from(residentMap.values()).some((resident) => {
      const phoneMatches =
        normalizePhoneKey(resident.phone) &&
        normalizePhoneKey(resident.phone) === normalizePhoneKey(kyc.customerPhone || kyc.phoneDigits);

      const idMatches =
        normalizeLookupKey(resident.id) === normalizeLookupKey(kyc.residentId);

      const nameMatches =
        kyc.customerName &&
        resident.name &&
        normalizeLookupKey(kyc.customerName) === normalizeLookupKey(resident.name);

      return phoneMatches || idMatches || nameMatches;
    });

    if (alreadyShown) return;

    const fallbackId = firstNonEmpty([
      kyc.residentId,
      kyc.customerPhone,
      kyc.phoneDigits,
      kyc.id
    ]);

    if (!fallbackId) return;

    residentMap.set(fallbackId, {
      id: fallbackId,
      name: firstNonEmpty([kyc.customerName, kyc.customerPhone, kyc.id]),
      phone: firstNonEmpty([kyc.customerPhone, kyc.phoneDigits]),
      email: "",
      propertyId: kyc.propertyId,
      propertyName: firstNonEmpty([
        kyc.propertyName,
        findPropertyNameFromMap(propertyMap, kyc.propertyId),
        "No Property"
      ]),
      roomNo: kyc.roomNo,
      kycDocId: kyc.id,
      aadhaarUrl: kyc.aadhaarUrl,
      aadhaarBackUrl: kyc.aadhaarBackUrl,
      panUrl: kyc.panUrl,
      photoUrl: kyc.photoUrl,
      agreementUrl: kyc.agreementUrl,
      kycStatus: normalizeKycStatusWithDocs(
        kyc.kycStatus,
        kyc.aadhaarUrl,
        kyc.aadhaarBackUrl,
        kyc.panUrl,
        kyc.photoUrl
      ),
      lastVerifiedAt: kyc.verifiedAt
    });
  });

  return Array.from(residentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function createAgreementRecord(raw, sourceCollection) {
  const acceptedAt = dateValue(raw, ["acceptedAt"]) ||
    toDate(valueText(raw, ["acceptedAtText"]));

  const signatureCode = firstNonEmpty([
    valueText(raw, ["signatureCode", "agreementSignatureCode"])
  ]);

  const rawStatus = firstNonEmpty([
    valueText(raw, ["status", "agreementStatus"]),
    raw.accepted === true ? "Accepted" : "",
    signatureCode ? "Accepted" : "",
    "Active"
  ]);

  const accepted =
    raw.accepted === true ||
    normalize(rawStatus) === "accepted" ||
    Boolean(acceptedAt) ||
    Boolean(signatureCode);

  const residentId = firstNonEmpty([
    valueText(raw, ["residentId", "userId"]),
    valueText(raw, ["residentPhone", "customerPhone", "phone", "mobile"])
  ]);

  const resident = findResidentByKeys([
    residentId,
    valueText(raw, ["residentPhone", "customerPhone", "phone", "mobile"]),
    valueText(raw, ["residentName", "customerName", "name"])
  ]);

  const propertyMap = getPropertyMap();
  const propertyId = valueText(raw, ["propertyId", "property_id"]);

  const startDate = dateValue(raw, ["startDate", "checkIn", "moveInDate"]);
  const endDate = dateValue(raw, ["endDate", "expiryDate", "checkOut", "moveOutDate"]);

  const roomNo = firstNonEmpty([
    valueText(raw, ["roomNo", "roomNumber"]),
    resident?.roomNo || ""
  ]);

  const bedNo = valueText(raw, ["bedNo", "bedNumber"]);

  return {
    id: raw.id,
    sourceCollection,
    residentId,
    residentName: firstNonEmpty([
      valueText(raw, ["residentName", "customerName", "name"]),
      resident?.name,
      "Resident"
    ]),
    residentPhone: firstNonEmpty([
      valueText(raw, ["residentPhone", "customerPhone", "phone", "mobile"]),
      resident?.phone
    ]),
    residentEmail: firstNonEmpty([
      valueText(raw, ["residentEmail", "email"]),
      resident?.email
    ]),
    propertyId,
    propertyName: firstNonEmpty([
      valueText(raw, ["propertyName", "property"]),
      findPropertyNameFromMap(propertyMap, propertyId),
      resident?.propertyName,
      "No Property"
    ]),
    unit: firstNonEmpty([
      valueText(raw, ["unit"]),
      roomNo,
      bedNo,
      resident?.roomNo
    ]),
    roomNo,
    bedNo,
    floorNo: valueText(raw, ["floorNo", "floorNumber"]),
    locationLine: valueText(raw, ["locationLine", "address", "location"]),
    sharingType: valueText(raw, ["sharingType", "roomType"]),
    foodLabel: valueText(raw, ["foodLabel", "food"]),
    wifiLabel: valueText(raw, ["wifiLabel", "wifi"]),
    stayPeriod: valueText(raw, ["stayPeriod"]),
    bookingCode: valueText(raw, ["bookingCode", "bookingId"]),
    agreementType: normalizeAgreementType(
      firstNonEmpty([
        valueText(raw, ["agreementType", "type"]),
        accepted ? "Digital Stay Agreement" : "Leave & License"
      ])
    ),
    startDate,
    endDate,
    rentAmount: numberValue(raw, ["rentAmount", "monthlyRent", "amount", "rent"]),
    securityDeposit: numberValue(raw, ["securityDeposit", "depositAmount"]),
    status: normalizeAgreementStatus(rawStatus, endDate, accepted),
    residentKycStatus: firstNonEmpty([
      valueText(raw, ["residentKycStatus", "kycStatus"]),
      resident?.kycStatus,
      "Pending"
    ]),
    notes: valueText(raw, ["notes"]),
    accepted,
    signatureCode: firstNonEmpty([
      signatureCode,
      accepted ? "Digitally Accepted" : ""
    ]),
    acceptedAt,
    createdAt: dateValue(raw, ["createdAt"]),
    original: raw
  };
}

function getAgreementRecords() {
  return [
    ...state.agreements.map((item) => createAgreementRecord(item, COLLECTIONS.agreements)),
    ...state.stayAgreements.map((item) => createAgreementRecord(item, COLLECTIONS.stayAgreements))
  ].sort((a, b) => {
    const bTime = b.createdAt?.getTime() || 0;
    const aTime = a.createdAt?.getTime() || 0;
    return bTime - aTime;
  });
}

function getSummary() {
  const now = new Date();
  const agreements = getAgreementRecords();
  const kycResidents = getKycResidents();

  const totalAgreements = agreements.length;
  const activeAgreements = agreements.filter((item) => {
    return item.status === "Active" || item.status === "Accepted";
  }).length;

  const expiringSoon = agreements.filter((item) => {
    const endDate = toDate(item.endDate);
    const status = item.status;

    if (!endDate) return false;
    if (status === "Expired" || status === "Terminated") return false;

    const days = Math.floor((endDate.getTime() - now.getTime()) / 86400000);
    return days >= 0 && days <= 30;
  }).length;

  const expiredAgreements = agreements.filter((item) => item.status === "Expired").length;

  const totalResidents = kycResidents.length;
  const verifiedKyc = kycResidents.filter((item) => item.kycStatus === "Verified").length;
  const pendingKyc = kycResidents.filter((item) => item.kycStatus === "Pending").length;
  const incompleteKyc = kycResidents.filter((item) => item.kycStatus === "Incomplete").length;

  return {
    totalAgreements,
    activeAgreements,
    expiringSoon,
    expiredAgreements,
    totalResidents,
    verifiedKyc,
    pendingKyc,
    incompleteKyc
  };
}

function countBy(items, getter) {
  const map = {};

  items.forEach((item) => {
    const key = getter(item) || "Not Added";
    map[key] = (map[key] || 0) + 1;
  });

  return map;
}

function renderBarChart(id, map, colorGetter) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(map)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const max = Math.max(...entries.map(([, value]) => value), 0);

  if (!entries.length || !max) {
    container.innerHTML = `<div class="empty-state">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value]) => {
    const width = Math.max(8, Math.round((value / max) * 100));
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

function renderMoneyChart() {
  const container = $("moneyChart");
  if (!container) return;

  const agreements = getAgreementRecords();
  const rent = agreements.reduce((sum, item) => sum + item.rentAmount, 0);
  const deposit = agreements.reduce((sum, item) => sum + item.securityDeposit, 0);

  const entries = [
    ["Total Rent", rent],
    ["Security Deposit", deposit]
  ].filter(([, value]) => value > 0);

  const max = Math.max(...entries.map(([, value]) => value), 0);

  if (!entries.length || !max) {
    container.innerHTML = `<div class="empty-state">No rent or deposit amount found.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value]) => {
    const width = Math.max(8, Math.round((value / max) * 100));
    const color = label.toLowerCase().includes("deposit") ? COLORS.purple : COLORS.gold;

    return `
      <div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color}"></div>
        </div>
        <strong>${escapeHtml(formatMoney(value))}</strong>
      </div>
    `;
  }).join("");
}

function getDocumentCounts(residents) {
  return {
    "Aadhaar Front": residents.filter((item) => item.aadhaarUrl).length,
    "Aadhaar Back": residents.filter((item) => item.aadhaarBackUrl).length,
    "PAN": residents.filter((item) => item.panUrl).length,
    "Photo": residents.filter((item) => item.photoUrl).length
  };
}

function renderPage() {
  renderTabs();
  renderFilterOptions();
  renderStats();
  renderCharts();
  renderList();
}

function renderTabs() {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });

  $("agreementsStats")?.classList.toggle("hidden", state.activeTab !== "agreements");
  $("kycStats")?.classList.toggle("hidden", state.activeTab !== "kyc");
  $("agreementsCharts")?.classList.toggle("hidden", state.activeTab !== "agreements");
  $("kycCharts")?.classList.toggle("hidden", state.activeTab !== "kyc");
  $("agreementStatusFilter")?.classList.toggle("hidden", state.activeTab !== "agreements");
  $("agreementTypeFilter")?.classList.toggle("hidden", state.activeTab !== "agreements");
  $("kycStatusFilter")?.classList.toggle("hidden", state.activeTab !== "kyc");

  const input = $("localSearchInput");
  if (input) {
    input.placeholder =
      state.activeTab === "agreements"
        ? "Search by resident, property, unit or status..."
        : "Search by resident, phone, property or KYC status...";
  }
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
  const agreements = getAgreementRecords();
  const kycResidents = getKycResidents();

  const properties = [
    "All Properties",
    ...new Set([
      ...agreements.map((item) => item.propertyName),
      ...kycResidents.map((item) => item.propertyName)
    ].filter(Boolean))
  ];

  updateSelect("propertyFilter", properties);
  updateSelect("agreementStatusFilter", ["All Status", ...new Set([...AGREEMENT_STATUSES, ...agreements.map((item) => item.status)])]);
  updateSelect("agreementTypeFilter", ["All Agreement Types", ...new Set([...AGREEMENT_TYPES, ...agreements.map((item) => item.agreementType)])]);
  updateSelect("kycStatusFilter", ["All KYC Status", ...KYC_STATUSES]);
}

function renderStats() {
  const summary = getSummary();

  setText("totalAgreementsValue", summary.totalAgreements);
  setText("activeAgreementsValue", summary.activeAgreements);
  setText("expiringSoonValue", summary.expiringSoon);
  setText("expiredAgreementsValue", summary.expiredAgreements);

  setText("totalResidentsValue", summary.totalResidents);
  setText("verifiedKycValue", summary.verifiedKyc);
  setText("pendingKycValue", summary.pendingKyc);
  setText("incompleteKycValue", summary.incompleteKyc);
}

function renderCharts() {
  const agreements = getAgreementRecords();
  const kycResidents = getKycResidents();

  renderBarChart("agreementStatusChart", countBy(agreements, (item) => item.status), statusColor);
  renderBarChart("agreementTypeChart", countBy(agreements, (item) => item.agreementType), agreementTypeColor);
  renderMoneyChart();
  renderBarChart("agreementPropertyChart", countBy(agreements, (item) => item.propertyName), propertyColor);

  renderBarChart("kycStatusChart", countBy(kycResidents, (item) => item.kycStatus), kycStatusColor);
  renderBarChart("kycDocumentChart", getDocumentCounts(kycResidents), documentColor);
  renderBarChart("kycPropertyChart", countBy(kycResidents, (item) => item.propertyName), propertyColor);
}

function getFilteredAgreements() {
  let items = getAgreementRecords();

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("localSearchInput")?.value);
  const search = localSearch || globalSearch;
  const property = $("propertyFilter")?.value || "All Properties";
  const status = $("agreementStatusFilter")?.value || "All Status";
  const type = $("agreementTypeFilter")?.value || "All Agreement Types";

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.residentName,
        item.residentPhone,
        item.propertyName,
        item.unit,
        item.agreementType,
        item.status,
        item.residentKycStatus
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (property !== "All Properties") {
    items = items.filter((item) => item.propertyName === property);
  }

  if (status !== "All Status") {
    items = items.filter((item) => item.status === status);
  }

  if (type !== "All Agreement Types") {
    items = items.filter((item) => item.agreementType === type);
  }

  items.sort((a, b) => {
    const rank = agreementStatusRank(a.status) - agreementStatusRank(b.status);
    if (rank !== 0) return rank;

    const aCreated = a.createdAt?.getTime() || 0;
    const bCreated = b.createdAt?.getTime() || 0;

    return bCreated - aCreated;
  });

  return items;
}

function getFilteredKycResidents() {
  let items = getKycResidents();

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("localSearchInput")?.value);
  const search = localSearch || globalSearch;
  const property = $("propertyFilter")?.value || "All Properties";
  const status = $("kycStatusFilter")?.value || "All KYC Status";

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.name,
        item.phone,
        item.email,
        item.propertyName,
        item.roomNo,
        item.kycStatus
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (property !== "All Properties") {
    items = items.filter((item) => item.propertyName === property);
  }

  if (status !== "All KYC Status") {
    items = items.filter((item) => item.kycStatus === status);
  }

  items.sort((a, b) => {
    const rank = kycStatusRank(a.kycStatus) - kycStatusRank(b.kycStatus);
    if (rank !== 0) return rank;

    return a.name.localeCompare(b.name);
  });

  return items;
}

function renderList() {
  if (state.activeTab === "agreements") {
    renderAgreementsList();
  } else {
    renderKycList();
  }
}

function renderAgreementsList() {
  const container = $("recordList");
  if (!container) return;

  const items = getFilteredAgreements();

  setText("listTitle", "Agreements & Acceptance Status");
  setText("listSubTitle", `${items.length} agreement records shown`);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">No agreements found. Resident agreements will appear here when added or accepted.</div>`;
    return;
  }

  container.innerHTML = items.map((item) => {
    const status = item.status;
    const kycStatus = normalizeKycStatus(item.residentKycStatus);

    return `
      <article class="record-row-card">
        <div class="avatar-box">${escapeHtml(getInitials(item.residentName))}</div>

        <div class="row-text">
          <strong>${escapeHtml(item.residentName)}</strong>
          <span>${escapeHtml(item.residentPhone || "No phone")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(item.propertyName)}</strong>
          <span>${escapeHtml(item.unit || "No unit")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(item.agreementType)}</strong>
          <span>${escapeHtml(formatDate(item.startDate))} - ${escapeHtml(formatDate(item.endDate))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatMoney(item.rentAmount))}</strong>
          <span>Deposit: ${escapeHtml(formatMoney(item.securityDeposit))}</span>
        </div>

        <div class="row-text desktop-col">
          <span class="tiny-chip ${statusClass(kycStatus)}">${escapeHtml(kycStatus)}</span>
        </div>

        <span class="tiny-chip ${statusClass(status)}">${escapeHtml(status)}</span>

        <div class="row-actions">
          <button type="button" title="View Agreement" data-view-agreement="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <select data-agreement-status="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}">
            ${AGREEMENT_STATUSES.map((value) => `
              <option value="${escapeHtml(value)}" ${status === value ? "selected" : ""}>
                ${escapeHtml(value)}
              </option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

function renderKycList() {
  const container = $("recordList");
  if (!container) return;

  const items = getFilteredKycResidents();

  setText("listTitle", "KYC Documents Uploaded by Residents");
  setText("listSubTitle", `${items.length} resident KYC records shown`);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">No KYC records found. KYC uploaded from resident app will appear here.</div>`;
    return;
  }

  container.innerHTML = items.map((item) => {
    return `
      <article class="record-row-card kyc">
        <div class="avatar-box">${escapeHtml(getInitials(item.name))}</div>

        <div class="row-text">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.phone || item.email || "No contact")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(item.propertyName)}</strong>
          <span>${escapeHtml(item.roomNo || "No unit")}</span>
        </div>

        <div class="doc-chips desktop-col">
          ${docChip("Aadhaar F", item.aadhaarUrl)}
          ${docChip("Aadhaar B", item.aadhaarBackUrl)}
          ${docChip("PAN", item.panUrl)}
          ${docChip("Photo", item.photoUrl)}
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatDate(item.lastVerifiedAt))}</strong>
          <span>Last verified</span>
        </div>

        <span class="tiny-chip ${statusClass(item.kycStatus)}">${escapeHtml(item.kycStatus)}</span>

        <div class="row-actions">
          <button type="button" title="View KYC" data-view-kyc="${escapeHtml(item.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <button type="button" title="Approve KYC" data-approve-kyc="${escapeHtml(item.id)}">
            <i class="fa-solid fa-circle-check"></i>
          </button>

          <select data-kyc-status="${escapeHtml(item.id)}">
            ${KYC_STATUSES.map((value) => `
              <option value="${escapeHtml(value)}" ${item.kycStatus === value ? "selected" : ""}>
                ${escapeHtml(value)}
              </option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

function docChip(label, value) {
  const available = Boolean(String(value || "").trim());

  return `
    <span class="doc-chip ${available ? "yes" : "no"}">
      <i class="fa-solid ${available ? "fa-check" : "fa-xmark"}"></i>
      ${escapeHtml(label)}
    </span>
  `;
}

function fillResidentSelect() {
  const select = $("agreementResidentInput");
  if (!select) return;

  select.innerHTML = `<option value="">Select resident</option>`;

  getResidentOptions().forEach((resident) => {
    const option = document.createElement("option");
    option.value = resident.id;
    option.textContent = `${resident.name}${resident.roomNo ? ` - ${resident.roomNo}` : resident.phone ? ` - ${resident.phone}` : ""}`;
    select.appendChild(option);
  });
}

function fillPropertySelect() {
  const select = $("agreementPropertyInput");
  if (!select) return;

  select.innerHTML = `<option value="">Select property</option>`;

  getPropertyOptions().forEach((property) => {
    const option = document.createElement("option");
    option.value = property.id;
    option.textContent = property.name;
    select.appendChild(option);
  });
}

function resetAgreementForm() {
  $("agreementForm")?.reset();

  fillResidentSelect();
  fillPropertySelect();

  const start = new Date();
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);

  $("agreementTypeInput").value = "Leave & License";
  $("agreementStatusInput").value = "Active";
  $("startDateInput").value = dateInputValue(start);
  $("endDateInput").value = dateInputValue(end);
}

function openAddAgreementModal() {
  resetAgreementForm();
  openModal("agreementModal");
}

async function saveAgreement(event) {
  event.preventDefault();

  if (state.savingAgreement) return;

  const form = $("agreementForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const resident = findResident($("agreementResidentInput").value);
  const property = findProperty($("agreementPropertyInput").value);

  if (!resident || !property) {
    showToast("Selected resident or property not found.", "error");
    return;
  }

  state.savingAgreement = true;
  $("saveAgreementBtn").disabled = true;
  $("saveAgreementBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const ref = doc(collection(db, COLLECTIONS.agreements));

    await setDoc(ref, {
      agreementId: ref.id,
      residentId: resident.id,
      residentName: resident.name,
      residentPhone: resident.phone,
      residentEmail: resident.email,
      propertyId: property.id,
      propertyName: property.name,
      unit: resident.roomNo,
      roomNo: resident.roomNo,
      agreementType: $("agreementTypeInput").value,
      startDate: Timestamp.fromDate(new Date(`${$("startDateInput").value}T00:00:00`)),
      endDate: Timestamp.fromDate(new Date(`${$("endDateInput").value}T00:00:00`)),
      rentAmount: Number($("rentAmountInput").value || 0),
      securityDeposit: Number($("securityDepositInput").value || 0),
      status: $("agreementStatusInput").value,
      agreementStatus: $("agreementStatusInput").value,
      residentKycStatus: resident.kycStatus,
      notes: $("agreementNotesInput").value.trim(),
      source: "admin_website",
      createdBy: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Agreement saved successfully.");
    closeModal("agreementModal");
  } catch (error) {
    console.error("Save agreement failed:", error);
    showToast(`Failed to save agreement: ${error.message}`, "error");
  } finally {
    state.savingAgreement = false;
    $("saveAgreementBtn").disabled = false;
    $("saveAgreementBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Agreement`;
  }
}

async function updateAgreementStatus(id, sourceCollection, status) {
  try {
    const collectionName = sourceCollection || COLLECTIONS.agreements;

    const data = {
      status,
      agreementStatus: status,
      updatedAt: serverTimestamp()
    };

    if (status === "Active") data.activatedAt = serverTimestamp();
    if (status === "Accepted") data.accepted = true;
    if (status === "Expired") data.expiredAt = serverTimestamp();
    if (status === "Terminated") data.terminatedAt = serverTimestamp();

    await setDoc(doc(db, collectionName, id), data, { merge: true });

    showToast(`Agreement marked as ${status}.`);
  } catch (error) {
    console.error("Agreement update failed:", error);
    showToast(`Failed to update agreement: ${error.message}`, "error");
  }
}

async function approveKyc(residentId) {
  await markKycStatus(residentId, "Verified", true);
}

async function markKycStatus(residentId, status, showApproveText = false) {
  const resident = getKycResidents().find((item) => item.id === residentId);
  if (!resident) return;

  try {
    const verified = status === "Verified";
    const batch = writeBatch(db);

    const data = {
      kycStatus: status,
      status: verified ? "Active" : "Pending",
      accountStatus: verified ? "Active" : "Pending",
      isActive: verified,
      kycVerified: verified,
      isKycVerified: verified,
      updatedAt: serverTimestamp()
    };

    if (verified) {
      data.verifiedAt = serverTimestamp();
      data.kycVerifiedAt = serverTimestamp();
    }

    batch.set(doc(db, COLLECTIONS.residents, resident.id), data, { merge: true });
    batch.set(doc(db, COLLECTIONS.users, resident.id), data, { merge: true });

    if (resident.kycDocId) {
      const kycData = {
        residentId: resident.id,
        residentName: resident.name,
        propertyId: resident.propertyId,
        propertyName: resident.propertyName,
        roomNo: resident.roomNo,
        kycStatus: status,
        status,
        isVerified: verified,
        updatedAt: serverTimestamp()
      };

      if (verified) kycData.verifiedAt = serverTimestamp();

      batch.set(doc(db, COLLECTIONS.kycDocuments, resident.kycDocId), kycData, { merge: true });
    } else {
      const kycRef = doc(collection(db, COLLECTIONS.kycDocuments));

      batch.set(kycRef, {
        residentId: resident.id,
        residentName: resident.name,
        propertyId: resident.propertyId,
        propertyName: resident.propertyName,
        roomNo: resident.roomNo,
        kycStatus: status,
        status,
        isVerified: verified,
        ifVerified: verified,
        ...(verified ? { verifiedAt: serverTimestamp() } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    await batch.commit();

    if (verified) {
      const agreementSnap = await getDocs(
        query(collection(db, COLLECTIONS.agreements), where("residentId", "==", resident.id))
      );

      const stayAgreementSnap = await getDocs(
        query(collection(db, COLLECTIONS.stayAgreements), where("residentId", "==", resident.id))
      );

      const agreementBatch = writeBatch(db);

      agreementSnap.docs.forEach((agreementDoc) => {
        agreementBatch.set(
          agreementDoc.ref,
          {
            residentKycStatus: "Verified",
            residentStatus: "Active",
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      });

      stayAgreementSnap.docs.forEach((agreementDoc) => {
        agreementBatch.set(
          agreementDoc.ref,
          {
            residentKycStatus: "Verified",
            residentStatus: "Active",
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      });

      await agreementBatch.commit();
    }

    showToast(
      showApproveText
        ? `${resident.name} KYC approved and marked active.`
        : `${resident.name} KYC marked as ${status}.`
    );
  } catch (error) {
    console.error("KYC update failed:", error);
    showToast(`Failed to update KYC: ${error.message}`, "error");
  }
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function docUrlOrPreview(label, value, iconClass = "fa-regular fa-file-lines") {
  const hasDoc = String(value || "").trim();
  const source = String(value || "").trim();
  const lower = source.toLowerCase();

  const isHttp = lower.startsWith("http");
  const looksImage =
    lower.startsWith("data:image") ||
    lower.includes(".jpg") ||
    lower.includes(".jpeg") ||
    lower.includes(".png") ||
    lower.includes(".webp") ||
    lower.includes("firebasestorage");

  const imgSrc = source.startsWith("data:")
    ? source
    : isHttp
      ? source
      : source
        ? `data:image/jpeg;base64,${source.includes(",") ? source.split(",").pop() : source}`
        : "";

  return `
    <div class="kyc-doc-preview ${hasDoc ? "" : "missing"}">
      <div class="kyc-doc-head">
        <i class="${hasDoc ? "fa-solid fa-circle-check" : iconClass}"></i>
        <span>${escapeHtml(label)}</span>
      </div>

      ${
        !hasDoc
          ? `<div class="kyc-doc-missing">Not uploaded</div>`
          : looksImage || !isHttp
            ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(label)}" onerror="this.outerHTML='<div class=&quot;kyc-doc-fallback&quot;>Uploaded document available</div>'" />`
            : `<div class="kyc-doc-fallback"><a href="${escapeHtml(source)}" target="_blank" rel="noopener">Open uploaded document</a></div>`
      }
    </div>
  `;
}

function agreementAcceptanceBanner(agreement) {
  if (agreement.accepted) {
    return `
      <div class="acceptance-banner">
        <i class="fa-solid fa-circle-check"></i>
        <div>
          <strong>Agreement Accepted by ${escapeHtml(agreement.residentName)}</strong>
          <span>Signature Code: ${escapeHtml(agreement.signatureCode || "-")} • Accepted On: ${escapeHtml(formatDate(agreement.acceptedAt))}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="acceptance-banner pending">
      <i class="fa-solid fa-clock"></i>
      <div>
        <strong>Agreement Not Accepted Yet</strong>
        <span>Once resident accepts in customer app, the digital stay agreement will appear here.</span>
      </div>
    </div>
  `;
}

function generatedAgreementView(agreement) {
  if (!agreement.accepted) {
    return `
      <div class="not-accepted-box">
        The resident has not accepted the digital stay agreement yet. Once the resident clicks “I Accept” in the customer app, the signed agreement will appear here automatically.
      </div>
    `;
  }

  return `
    <div class="generated-agreement">
      <div class="generated-agreement-title">
        <strong>LIVELY LEGACY ACCOMMODATIONS</strong>
        <span>DIGITAL STAY AGREEMENT</span>
      </div>

      <div class="detail-grid">
        ${detailLine("Resident", agreement.residentName)}
        ${detailLine("Phone", agreement.residentPhone)}
        ${detailLine("Booking Code", agreement.bookingCode)}
        ${detailLine("Property", agreement.propertyName)}
        ${detailLine("Location", agreement.locationLine)}
        ${detailLine("Room No.", agreement.roomNo)}
        ${detailLine("Bed No.", agreement.bedNo)}
        ${detailLine("Floor No.", agreement.floorNo)}
        ${detailLine("Sharing Type", agreement.sharingType)}
        ${detailLine("Food Facility", agreement.foodLabel)}
        ${detailLine("Wi-Fi", agreement.wifiLabel)}
        ${detailLine("Move-in Date", formatDate(agreement.startDate))}
        ${detailLine("Move-out Date", formatDate(agreement.endDate))}
        ${detailLine("Stay Period", agreement.stayPeriod)}
        ${detailLine("Rent", formatMoney(agreement.rentAmount))}
      </div>

      <div class="signature-panel">
        <span>Resident Digital Signature</span>
        <strong>${escapeHtml(agreement.residentName)}</strong>
        <small>Signature Code: ${escapeHtml(agreement.signatureCode || "-")}</small>
        <small>Accepted On: ${escapeHtml(formatDate(agreement.acceptedAt))}</small>
      </div>
    </div>
  `;
}

function openAgreementDetail(id, sourceCollection) {
  const item = getAgreementRecords().find((agreement) => {
    return agreement.id === id && agreement.sourceCollection === sourceCollection;
  });

  if (!item) return;

  setText("detailAgreementTitle", item.residentName);
  setText("detailAgreementSub", item.agreementType);

  const content = $("agreementDetailContent");
  if (!content) return;

  content.innerHTML = `
    ${agreementAcceptanceBanner(item)}

    <div class="detail-grid">
      ${detailLine("Resident", item.residentName)}
      ${detailLine("Resident Phone", item.residentPhone)}
      ${detailLine("Resident Email", item.residentEmail)}
      ${detailLine("Property", item.propertyName)}
      ${detailLine("Location", item.locationLine)}
      ${detailLine("Unit", item.unit)}
      ${detailLine("Room No.", item.roomNo)}
      ${detailLine("Bed No.", item.bedNo)}
      ${detailLine("Floor No.", item.floorNo)}
      ${detailLine("Agreement Type", item.agreementType)}
      ${detailLine("Start Date", formatDate(item.startDate))}
      ${detailLine("End Date", formatDate(item.endDate))}
      ${detailLine("Status", item.status)}
      ${detailLine("KYC Status", item.residentKycStatus)}
      ${detailLine("Rent Amount", formatMoney(item.rentAmount))}
      ${detailLine("Security Deposit", formatMoney(item.securityDeposit))}
      ${detailLine("Notes", item.notes)}
    </div>

    ${generatedAgreementView(item)}

    <div class="detail-actions">
      <button type="button" class="gold-action" data-detail-agreement="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}" data-status-value="Active">Active</button>
      <button type="button" class="green-action" data-detail-agreement="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}" data-status-value="Accepted">Accepted</button>
      <button type="button" class="orange-action" data-detail-agreement="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}" data-status-value="Expiring Soon">Expiring Soon</button>
      <button type="button" class="red-action" data-detail-agreement="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}" data-status-value="Expired">Expired</button>
      <button type="button" class="red-action" data-detail-agreement="${escapeHtml(item.id)}" data-source="${escapeHtml(item.sourceCollection)}" data-status-value="Terminated">Terminate</button>
    </div>
  `;

  openModal("agreementDetailModal");
}

function openKycDetail(id) {
  const item = getKycResidents().find((resident) => resident.id === id);
  if (!item) return;

  setText("detailKycTitle", item.name);
  setText("detailKycSub", "KYC Verification");

  const content = $("kycDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="detail-grid">
      ${detailLine("Phone", item.phone)}
      ${detailLine("Email", item.email)}
      ${detailLine("Property", item.propertyName)}
      ${detailLine("Unit", item.roomNo)}
      ${detailLine("KYC Status", item.kycStatus)}
      ${detailLine("Last Verified", formatDate(item.lastVerifiedAt))}
    </div>

    ${docUrlOrPreview("Aadhaar Card Front", item.aadhaarUrl, "fa-regular fa-id-card")}
    ${docUrlOrPreview("Aadhaar Card Back", item.aadhaarBackUrl, "fa-regular fa-id-card")}
    ${docUrlOrPreview("PAN Card", item.panUrl, "fa-regular fa-credit-card")}
    ${docUrlOrPreview("Customer Photo", item.photoUrl, "fa-regular fa-user")}

    <div class="detail-actions">
      <button type="button" class="gold-action" data-kyc-action="${escapeHtml(item.id)}" data-kyc-value="Verified">
        Approve KYC
      </button>

      <button type="button" class="orange-action" data-kyc-action="${escapeHtml(item.id)}" data-kyc-value="Pending">
        Mark Pending
      </button>

      <button type="button" class="red-action" data-kyc-action="${escapeHtml(item.id)}" data-kyc-value="Incomplete">
        Mark Incomplete
      </button>
    </div>
  `;

  openModal("kycDetailModal");
}

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

  if (![...document.querySelectorAll(".modal-overlay")].some((item) => !item.hidden)) {
    document.body.style.overflow = "";
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.hidden = true;
  });

  document.body.style.overflow = "";
}

function clearFilters() {
  $("globalSearchInput").value = "";
  $("localSearchInput").value = "";
  $("propertyFilter").value = "All Properties";

  if ($("agreementStatusFilter")) $("agreementStatusFilter").value = "All Status";
  if ($("agreementTypeFilter")) $("agreementTypeFilter").value = "All Agreement Types";
  if ($("kycStatusFilter")) $("kycStatusFilter").value = "All KYC Status";

  renderList();
}

function setupEvents() {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      $("localSearchInput").value = "";
      renderPage();
    });
  });

  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Refreshed.");
  });

  $("openAgreementModalBtn")?.addEventListener("click", openAddAgreementModal);
  $("agreementForm")?.addEventListener("submit", saveAgreement);

  $("agreementResidentInput")?.addEventListener("change", () => {
    const resident = findResident($("agreementResidentInput").value);
    if (resident && resident.propertyId) {
      $("agreementPropertyInput").value = resident.propertyId;
    }
  });

  ["globalSearchInput", "localSearchInput"].forEach((id) => {
    $(id)?.addEventListener("input", renderList);
  });

  [
    "propertyFilter",
    "agreementStatusFilter",
    "agreementTypeFilter",
    "kycStatusFilter"
  ].forEach((id) => {
    $(id)?.addEventListener("change", renderList);
  });

  $("clearFiltersBtn")?.addEventListener("click", clearFilters);

  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) {
      closeModal(closeButton.dataset.closeModal);
      return;
    }

    if (event.target.classList.contains("modal-overlay")) {
      closeModal(event.target.id);
      return;
    }

    const viewAgreement = event.target.closest("[data-view-agreement]");
    if (viewAgreement) {
      openAgreementDetail(viewAgreement.dataset.viewAgreement, viewAgreement.dataset.source);
      return;
    }

    const viewKyc = event.target.closest("[data-view-kyc]");
    if (viewKyc) {
      openKycDetail(viewKyc.dataset.viewKyc);
      return;
    }

    const approveKycButton = event.target.closest("[data-approve-kyc]");
    if (approveKycButton) {
      approveKyc(approveKycButton.dataset.approveKyc);
      return;
    }

    const detailAgreementButton = event.target.closest("[data-detail-agreement]");
    if (detailAgreementButton) {
      updateAgreementStatus(
        detailAgreementButton.dataset.detailAgreement,
        detailAgreementButton.dataset.source,
        detailAgreementButton.dataset.statusValue
      );
      closeModal("agreementDetailModal");
      return;
    }

    const kycAction = event.target.closest("[data-kyc-action]");
    if (kycAction) {
      markKycStatus(kycAction.dataset.kycAction, kycAction.dataset.kycValue, kycAction.dataset.kycValue === "Verified");
      closeModal("kycDetailModal");
    }
  });

  document.addEventListener("change", (event) => {
    const agreementStatusSelect = event.target.closest("[data-agreement-status]");
    if (agreementStatusSelect) {
      updateAgreementStatus(
        agreementStatusSelect.dataset.agreementStatus,
        agreementStatusSelect.dataset.source,
        agreementStatusSelect.value
      );
      return;
    }

    const kycStatusSelect = event.target.closest("[data-kyc-status]");
    if (kycStatusSelect) {
      markKycStatus(
        kycStatusSelect.dataset.kycStatus,
        kycStatusSelect.value,
        kycStatusSelect.value === "Verified"
      );
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});