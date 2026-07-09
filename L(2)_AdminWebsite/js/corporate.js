import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  corporates: "corporates",
  corporateContracts: "corporate_contracts",
  residents: "residents",
  users: "users",
  properties: "properties",
  rooms: "rooms",
  beds: "beds"
};

const CORPORATE_STATUSES = ["Active", "Expiring Soon", "Inactive", "Draft", "Expired"];
const CONTRACT_STATUSES = ["Active", "Expiring Soon", "Expired", "Inactive", "Draft"];

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

const state = {
  corporates: [],
  corporateContracts: [],
  residents: [],
  users: [],
  properties: [],
  rooms: [],
  beds: [],
  selectedCorporateId: "",
  selectedBedIds: new Set(),
  saving: false,
  selectedDetailsId: ""
};

const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value;
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const normalize = (value) => String(value || "").trim().toLowerCase();

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

function integerValue(value) {
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

function formatDateInput(date) {
  const d = toDate(date);
  if (!d) return "";

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function inputDateToTimestamp(value) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return Timestamp.fromDate(date);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (amount <= 0) return "-";

  return amount.toLocaleString("en-IN", {
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
    document.querySelectorAll(".nav-dropdown.active").forEach((item) => item.classList.remove("active"));
  });

  profileDropdown?.addEventListener("click", (event) => event.stopPropagation());

  document.addEventListener("click", (event) => {
    const dropdownButton = event.target.closest(".nav-dropdown-btn");
    const dropdownBox = event.target.closest(".nav-dropdown");
    const submenuLink = event.target.closest(".nav-submenu a");

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

    if (submenuLink) {
      document.querySelectorAll(".nav-dropdown.active").forEach((item) => {
        item.classList.remove("active");
      });
      return;
    }

    if (!dropdownBox) {
      document.querySelectorAll(".nav-dropdown.active").forEach((item) => {
        item.classList.remove("active");
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
  listenCollection("corporates", COLLECTIONS.corporates);
  listenCollection("corporateContracts", COLLECTIONS.corporateContracts);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("rooms", COLLECTIONS.rooms);
  listenCollection("beds", COLLECTIONS.beds);
}

/* NORMALIZERS */

function normalizeCorporateStatus(value) {
  const clean = normalize(value).replaceAll("_", " ");

  if (clean === "active" || clean === "approved") return "Active";
  if (clean === "expiring soon") return "Expiring Soon";
  if (clean === "inactive" || clean === "disabled") return "Inactive";
  if (clean === "draft") return "Draft";
  if (clean === "expired") return "Expired";

  return "Active";
}

function normalizeContractStatus(value) {
  return normalizeCorporateStatus(value);
}

function statusClass(value) {
  return normalize(value).replaceAll(" ", "-");
}

function statusColor(value) {
  const clean = normalizeCorporateStatus(value);

  if (clean === "Active") return COLORS.green;
  if (clean === "Expiring Soon") return COLORS.orange;
  if (clean === "Inactive") return COLORS.grey;
  if (clean === "Draft") return COLORS.blue;
  if (clean === "Expired") return COLORS.red;

  return COLORS.navy;
}

function chartColor(label) {
  const colors = [
    COLORS.blue,
    COLORS.green,
    COLORS.orange,
    COLORS.purple,
    COLORS.gold,
    COLORS.red,
    COLORS.navy
  ];

  const hash = String(label || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/* DATA GETTERS */

function getPropertyName(property) {
  return firstNonEmpty([property.propertyName, property.name, property.title], property.id);
}

function getPropertyMap() {
  const map = new Map();

  state.properties.forEach((property) => {
    const name = getPropertyName(property);
    const keys = [
      property.id,
      property.propertyId,
      property.property_id,
      property.propertyCode,
      property.propertyName,
      property.name,
      name
    ];

    keys.filter(Boolean).forEach((key) => map.set(String(key), { id: property.id, name }));
  });

  return map;
}

function getPropertyById(id) {
  const propertyMap = getPropertyMap();
  return propertyMap.get(String(id || "")) || null;
}

function getCorporateName(item) {
  return firstNonEmpty([item.corporateName, item.companyName, item.name], "Corporate");
}

function getCorporateCode(item) {
  return firstNonEmpty([item.corporateCode, item.companyCode], item.id);
}

function getCompanyEmail(item) {
  return firstNonEmpty([item.companyEmail, item.email], "");
}

function getCompanyPhone(item) {
  return firstNonEmpty([item.companyPhone, item.phone], "");
}

function getIndustryType(item) {
  return firstNonEmpty([item.industryType, item.industry], "Not Added");
}

function getGstNumber(item) {
  return firstNonEmpty([item.gstNumber, item.gst], "");
}

function getCorporateAddress(item) {
  return firstNonEmpty([item.corporateAddress, item.address, item.companyAddress], "");
}

function getCompanyLogo(item) {
  return firstNonEmpty([item.companyLogoUrl, item.logoUrl, item.companyLogo], "");
}

function getContactName(item) {
  return firstNonEmpty([item.contactPersonName, item.contactName, item.contactPerson], "");
}

function getDesignation(item) {
  return firstNonEmpty([item.designation], "");
}

function getContactEmail(item) {
  return firstNonEmpty([item.contactEmail], "");
}

function getContactPhone(item) {
  return firstNonEmpty([item.contactPhone], "");
}

function getAlternatePhone(item) {
  return firstNonEmpty([item.alternateContactNumber, item.alternatePhone], "");
}

function getCorporatePropertyId(item) {
  return firstNonEmpty([item.propertyId, item.property_id], "");
}

function getCorporatePropertyName(item) {
  const property = getPropertyById(getCorporatePropertyId(item));

  return firstNonEmpty([
    item.propertyName,
    item.property,
    property?.name
  ], "No Property");
}

function getCorporateStatus(item) {
  return normalizeCorporateStatus(firstNonEmpty([
    item.status,
    item.corporateStatus,
    item.isActive === true ? "Active" : ""
  ], "Active"));
}

function getLatestContract(item) {
  const contracts = state.corporateContracts
    .filter((contract) => {
      return (
        String(contract.corporateId || "") === String(item.id) ||
        String(contract.companyId || "") === String(item.id) ||
        String(contract.id || "") === String(item.latestContractId || "")
      );
    })
    .sort((a, b) => {
      const dateA = toDate(a.createdAt)?.getTime() || 0;
      const dateB = toDate(b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });

  return contracts[0] || null;
}

function getCorporateContracts(item) {
  return state.corporateContracts.filter((contract) => {
    return (
      String(contract.corporateId || "") === String(item.id) ||
      String(contract.companyId || "") === String(item.id)
    );
  });
}

function getLatestContractStatus(item) {
  const latest = getLatestContract(item);

  return normalizeContractStatus(firstNonEmpty([
    item.latestContractStatus,
    latest?.status,
    latest?.contractStatus,
    latest?.isActive === true ? "Active" : ""
  ], "Active"));
}

function getContractNumber(contract) {
  return firstNonEmpty([contract.contractNumber, contract.contractNo], contract.id);
}

function getContractStatus(contract) {
  return normalizeContractStatus(firstNonEmpty([
    contract.status,
    contract.contractStatus,
    contract.isActive === true ? "Active" : ""
  ], "Active"));
}

function getContractMonthlyValue(contract) {
  return numberValue(firstNonEmpty([
    contract.monthlyContractValue,
    contract.monthlyValue,
    contract.contractValue
  ], 0));
}

function getMonthlyContractValue(item) {
  const latest = getLatestContract(item);

  return numberValue(firstNonEmpty([
    item.monthlyContractValue,
    item.monthlyValue,
    item.monthlyRent,
    latest?.monthlyContractValue,
    latest?.monthlyValue
  ], 0));
}

function getSecurityDeposit(item) {
  const latest = getLatestContract(item);

  return numberValue(firstNonEmpty([
    item.securityDeposit,
    latest?.securityDeposit
  ], 0));
}

function getTotalOutstanding(item) {
  return numberValue(firstNonEmpty([item.totalOutstanding, item.outstanding, item.outstandingAmount], 0));
}

function getContractStartDate(item) {
  const latest = getLatestContract(item);
  return item.contractStartDate || latest?.startDate || latest?.contractStartDate || "";
}

function getContractEndDate(item) {
  const latest = getLatestContract(item);
  return item.contractEndDate || latest?.endDate || latest?.contractEndDate || "";
}

function getNoticePeriodDays(item) {
  const latest = getLatestContract(item);

  return integerValue(firstNonEmpty([
    item.noticePeriodDays,
    latest?.noticePeriodDays
  ], 0));
}

function getBillingCycle(item) {
  const latest = getLatestContract(item);

  return firstNonEmpty([
    item.billingCycle,
    latest?.billingCycle
  ], "Monthly");
}

function getPaymentTerms(item) {
  const latest = getLatestContract(item);

  return firstNonEmpty([
    item.paymentTerms,
    latest?.paymentTerms
  ], "Net 15 Days");
}

function getRoomType(item) {
  const latest = getLatestContract(item);

  return firstNonEmpty([
    item.roomType,
    latest?.roomType
  ], "Single Occupancy");
}

function getOccupancyType(item) {
  const latest = getLatestContract(item);

  return firstNonEmpty([
    item.occupancyType,
    latest?.occupancyType
  ], "Single Occupancy");
}

function getTotalBedsAllotted(item) {
  return integerValue(firstNonEmpty([
    item.totalBedsAllotted,
    item.reservedBedCount,
    item.beds
  ], 0));
}

function getActiveResidentCount(item) {
  const corporateId = String(item.id);

  const countResidents = (list) => list.filter((resident) => {
    const itemCorporateId = firstNonEmpty([resident.corporateId, resident.companyId], "");
    return String(itemCorporateId) === corporateId;
  }).length;

  const counted = countResidents(state.residents) + countResidents(state.users);

  if (counted > 0) return counted;

  return integerValue(firstNonEmpty([
    item.activeResidents,
    item.residents,
    item.residentCount
  ], 0));
}

function getAgreementUrl(item) {
  const latest = getLatestContract(item);

  return firstNonEmpty([
    item.agreementUrl,
    latest?.agreementUrl
  ], "");
}

function getNotes(item) {
  return firstNonEmpty([item.notes], "");
}

function getReservedForEmployees(item) {
  const latest = getLatestContract(item);
  return item.reservedForEmployees === true || latest?.reservedForEmployees === true;
}

function getSelectedBedIds(item) {
  const ids = item.selectedBedIds || item.allottedBedIds || [];
  return Array.isArray(ids) ? ids : [];
}

/* FORM OPTIONS */

function getPropertyOptions() {
  return state.properties
    .map((property) => ({
      id: property.id,
      name: getPropertyName(property)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getRoomPropertyId(room) {
  return firstNonEmpty([room.propertyId, room.property_id], "");
}

function getRoomPropertyName(room) {
  const property = getPropertyById(getRoomPropertyId(room));

  return firstNonEmpty([
    room.propertyName,
    room.property,
    property?.name
  ], "");
}

function getRoomNo(room) {
  return firstNonEmpty([room.roomNo, room.roomNumber, room.roomName, room.name], room.id)
    .replace(/^Room\s+/i, "");
}

function getRoomTypeValue(room) {
  return firstNonEmpty([room.roomType, room.sharingType, room.bedType, room.occupancyType], "Room");
}

function getBedRoomId(bed) {
  return firstNonEmpty([bed.roomId, bed.room_id], "");
}

function getRoomById(id) {
  return state.rooms.find((room) => String(room.id) === String(id)) || null;
}

function normalizeBedOption(bed) {
  const room = getRoomById(getBedRoomId(bed));
  const propertyId = firstNonEmpty([bed.propertyId, bed.property_id, room ? getRoomPropertyId(room) : ""], "");
  const property = getPropertyById(propertyId);
  const bedNo = firstNonEmpty([bed.bedNo, bed.bedNumber, bed.bedName, bed.name], bed.id).replace(/^Bed\s+/i, "");
  const roomNo = firstNonEmpty([bed.roomNo, bed.roomNumber, bed.roomName, room ? getRoomNo(room) : ""], "").replace(/^Room\s+/i, "");

  return {
    id: bed.id,
    propertyId,
    propertyName: firstNonEmpty([bed.propertyName, bed.property, room ? getRoomPropertyName(room) : "", property?.name], ""),
    roomId: getBedRoomId(bed),
    roomNo,
    bedNo,
    bedName: firstNonEmpty([bed.bedName, bed.name], `Bed ${bedNo}`),
    roomType: firstNonEmpty([bed.roomType, bed.sharingType, bed.bedType, bed.occupancyType, room ? getRoomTypeValue(room) : ""], "Room"),
    status: firstNonEmpty([bed.status, bed.bedStatus, bed.isOccupied === true ? "occupied" : "available"], "available"),
    isOccupied: bed.isOccupied === true,
    reservedForCorporate:
      bed.reservedForCorporate === true ||
      bed.corporateReserved === true ||
      firstNonEmpty([bed.corporateId, bed.reservedCorporateId], "") !== "",
    monthlyRent: numberValue(firstNonEmpty([
      bed.monthlyRent,
      bed.rentAmount,
      bed.bedRent,
      bed.bedMonthlyRent,
      bed.rent,
      bed.bedPrice,
      bed.price,
      bed.amount
    ], 0))
  };
}

function bedMatchesProperty(bed, propertyId, propertyName) {
  return bed.propertyId === propertyId || (bed.propertyName && bed.propertyName === propertyName);
}

function isBedAvailableForCorporate(bed) {
  const cleanStatus = normalize(bed.status);

  const statusAvailable =
    !cleanStatus ||
    cleanStatus === "available" ||
    cleanStatus === "vacant" ||
    cleanStatus === "free";

  return statusAvailable && !bed.isOccupied && !bed.reservedForCorporate;
}

function availableRoomTypesFor(propertyId, propertyName) {
  const values = new Set();

  state.beds.map(normalizeBedOption).forEach((bed) => {
    if (!bedMatchesProperty(bed, propertyId, propertyName)) return;
    if (!isBedAvailableForCorporate(bed)) return;
    if (bed.roomType) values.add(bed.roomType);
  });

  if (!values.size) {
    state.rooms.forEach((room) => {
      const roomPropertyId = getRoomPropertyId(room);
      const roomPropertyName = getRoomPropertyName(room);

      if (roomPropertyId !== propertyId && roomPropertyName !== propertyName) return;

      const roomType = getRoomTypeValue(room);
      if (roomType) values.add(roomType);
    });
  }

  return [...values].sort();
}

function availableBedsFor(propertyId, propertyName, roomType) {
  const cleanRoomType = normalize(roomType);

  return state.beds
    .map(normalizeBedOption)
    .filter((bed) => {
      return (
        bedMatchesProperty(bed, propertyId, propertyName) &&
        isBedAvailableForCorporate(bed) &&
        normalize(bed.roomType) === cleanRoomType
      );
    })
    .sort((a, b) => {
      const roomCompare = a.roomNo.localeCompare(b.roomNo);
      if (roomCompare !== 0) return roomCompare;
      return a.bedNo.localeCompare(b.bedNo);
    });
}

/* RENDER */

function renderPage() {
  renderFilters();
  renderStats();
  renderCharts();
  renderCorporateList();
  renderContractsList();

  const selected = state.corporates.find((item) => item.id === state.selectedCorporateId);
  renderDetailsPanel(selected || null);
}

function updateSelectOptions(id, values) {
  const select = $(id);
  if (!select) return;

  const previous = select.value;
  const unique = [...new Set(values.filter(Boolean))];

  select.innerHTML = unique
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");

  select.value = unique.includes(previous) ? previous : unique[0];
}

function renderFilters() {
  updateSelectOptions("statusFilter", [
    "All Status",
    ...new Set([
      ...CORPORATE_STATUSES,
      ...state.corporates.map(getCorporateStatus)
    ])
  ]);

  updateSelectOptions("propertyFilter", [
    "All Properties",
    ...new Set(state.corporates.map(getCorporatePropertyName).filter(Boolean))
  ]);

  updateSelectOptions("contractFilter", [
    "All Contracts",
    ...new Set([
      ...CONTRACT_STATUSES,
      ...state.corporates.map(getLatestContractStatus)
    ])
  ]);
}

function renderStats() {
  const activeCorporates = state.corporates.filter((item) => getCorporateStatus(item) === "Active").length;
  const activeContracts = state.corporateContracts.filter((item) => getContractStatus(item) === "Active").length;

  const residents = state.corporates.reduce((sum, item) => {
    return sum + getActiveResidentCount(item);
  }, 0);

  const totalContractValue = state.corporates.reduce((sum, item) => {
    return sum + getMonthlyContractValue(item);
  }, 0);

  setText("totalCorporateValue", state.corporates.length);
  setText("activeCorporateValue", activeCorporates);
  setText("activeContractsValue", activeContracts);
  setText("corporateResidentsValue", residents);
  setText("contractValueValue", formatMoney(totalContractValue));
}

function countBy(items, getter) {
  const map = {};

  items.forEach((item) => {
    const key = getter(item) || "Not Added";
    map[key] = (map[key] || 0) + 1;
  });

  return map;
}

function sumByGroup(items, groupGetter, valueGetter) {
  const map = {};

  items.forEach((item) => {
    const key = groupGetter(item) || "Not Added";
    map[key] = (map[key] || 0) + Number(valueGetter(item) || 0);
  });

  return map;
}

function renderCharts() {
  renderBarChart(
    "corporateStatusChart",
    countBy(state.corporates, getCorporateStatus),
    statusColor,
    (value) => value.toString()
  );

  renderBarChart(
    "contractStatusChart",
    countBy(state.corporateContracts, getContractStatus),
    statusColor,
    (value) => value.toString()
  );

  renderBarChart(
    "industryChart",
    countBy(state.corporates, getIndustryType),
    chartColor,
    (value) => value.toString()
  );

  renderBarChart(
    "propertyContractValueChart",
    sumByGroup(state.corporates, getCorporatePropertyName, getMonthlyContractValue),
    chartColor,
    formatMoney
  );
}

function renderBarChart(id, map, colorGetter, formatter) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(map)
    .filter(([key, value]) => key && Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 7);

  const max = Math.max(...entries.map(([, value]) => Number(value)), 0);

  if (!entries.length || !max) {
    container.innerHTML = `<div class="empty-state small">No chart data yet.</div>`;
    return;
  }

  container.innerHTML = entries.map(([label, value]) => {
    const numericValue = Number(value);
    const width = Math.max(5, Math.round((numericValue / max) * 100));
    const color = colorGetter(label);

    return `
      <div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color};"></div>
        </div>
        <strong>${escapeHtml(formatter(numericValue))}</strong>
      </div>
    `;
  }).join("");
}

function filteredCorporates() {
  let items = [...state.corporates];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("corporateSearchInput")?.value);
  const search = localSearch || globalSearch;
  const status = $("statusFilter")?.value || "All Status";
  const property = $("propertyFilter")?.value || "All Properties";
  const contract = $("contractFilter")?.value || "All Contracts";

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        getCorporateName(item),
        getCorporateCode(item),
        getCompanyEmail(item),
        getCompanyPhone(item),
        getContactName(item),
        getContactPhone(item),
        getCorporatePropertyName(item),
        getCorporateStatus(item),
        getLatestContractStatus(item)
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (status !== "All Status") {
    items = items.filter((item) => getCorporateStatus(item) === status);
  }

  if (property !== "All Properties") {
    items = items.filter((item) => getCorporatePropertyName(item) === property);
  }

  if (contract !== "All Contracts") {
    items = items.filter((item) => getLatestContractStatus(item) === contract);
  }

  items.sort((a, b) => {
    const rankA = corporateStatusRank(getCorporateStatus(a));
    const rankB = corporateStatusRank(getCorporateStatus(b));

    if (rankA !== rankB) return rankA - rankB;

    const dateA = toDate(a.createdAt)?.getTime() || 0;
    const dateB = toDate(b.createdAt)?.getTime() || 0;

    return dateB - dateA;
  });

  return items;
}

function corporateStatusRank(status) {
  const clean = normalizeCorporateStatus(status);

  if (clean === "Active") return 1;
  if (clean === "Expiring Soon") return 2;
  if (clean === "Draft") return 3;
  if (clean === "Inactive") return 4;
  if (clean === "Expired") return 5;

  return 6;
}

function renderLogo(item) {
  const logo = getCompanyLogo(item);
  const name = getCorporateName(item);

  if (logo) {
    return `
      <div class="logo-box">
        <img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" onerror="this.parentElement.textContent='${escapeHtml(getInitials(name))}'" />
      </div>
    `;
  }

  return `<div class="logo-box">${escapeHtml(getInitials(name))}</div>`;
}

function renderCorporateList() {
  const container = $("corporateList");
  if (!container) return;

  const items = filteredCorporates();

  if (!state.selectedCorporateId && items.length) {
    state.selectedCorporateId = items[0].id;
  }

  setText("tableSummary", `${items.length} corporate records shown`);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">No corporate clients found.</div>`;
    renderDetailsPanel(null);
    return;
  }

  container.innerHTML = items.map((item) => {
    const selectedClass = item.id === state.selectedCorporateId ? "selected" : "";
    const status = getCorporateStatus(item);

    return `
      <article class="corporate-row ${selectedClass}" data-select-corporate="${escapeHtml(item.id)}">
        ${renderLogo(item)}

        <div class="row-text">
          <strong>${escapeHtml(getCorporateName(item))}</strong>
          <span>${escapeHtml(getCorporateCode(item))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getContactName(item) || "-")}</strong>
          <span>${escapeHtml(getContactPhone(item) || getCompanyPhone(item) || "-")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getCorporatePropertyName(item))}</strong>
          <span>${escapeHtml(getOccupancyType(item))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${getActiveResidentCount(item)}</strong>
          <span>Active Residents</span>
        </div>

        <span class="status-chip ${statusClass(status)}">${escapeHtml(status)}</span>

        <div class="row-actions">
          <button class="icon-btn" type="button" title="View" data-open-corporate="${escapeHtml(item.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <select class="status-select" data-change-corporate-status="${escapeHtml(item.id)}">
            ${CORPORATE_STATUSES.map((value) => `
              <option value="${escapeHtml(value)}" ${value === status ? "selected" : ""}>${escapeHtml(value)}</option>
            `).join("")}
          </select>

          <button class="danger-icon-btn" type="button" title="Delete" data-delete-corporate="${escapeHtml(item.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");

  const selected = state.corporates.find((item) => item.id === state.selectedCorporateId) || items[0];
  renderDetailsPanel(selected || null);
}

function renderContractsList() {
  const container = $("contractsList");
  if (!container) return;

  const items = [...state.corporateContracts]
    .sort((a, b) => {
      const dateA = toDate(a.createdAt)?.getTime() || 0;
      const dateB = toDate(b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    })
    .slice(0, 8);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state small">No contracts found.</div>`;
    return;
  }

  container.innerHTML = items.map((contract) => {
    const status = getContractStatus(contract);

    return `
      <article class="contract-row">
        <div class="row-text">
          <strong>${escapeHtml(firstNonEmpty([contract.corporateName, "Corporate"]))}</strong>
          <span>${escapeHtml(getContractNumber(contract))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(firstNonEmpty([contract.propertyName, "No Property"]))}</strong>
          <span>${escapeHtml(firstNonEmpty([contract.roomType, contract.occupancyType], "-"))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatDate(contract.startDate || contract.contractStartDate))}</strong>
          <span>Start Date</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatDate(contract.endDate || contract.contractEndDate))}</strong>
          <span>End Date</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${integerValue(firstNonEmpty([contract.activeResidents, contract.residents], 0))}</strong>
          <span>Residents</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatMoney(getContractMonthlyValue(contract)))}</strong>
          <span>Monthly Value</span>
        </div>

        <span class="status-chip ${statusClass(status)}">${escapeHtml(status)}</span>

        <div class="row-actions">
          <select class="status-select" data-change-contract-status="${escapeHtml(contract.id)}">
            ${CONTRACT_STATUSES.map((value) => `
              <option value="${escapeHtml(value)}" ${value === status ? "selected" : ""}>${escapeHtml(value)}</option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

function renderDetailsPanel(item) {
  const body = $("corporateDetailsBody");
  if (!body) return;

  if (!item) {
    setText("detailsSubtitle", "Select a corporate to view details.");
    body.innerHTML = `<div class="empty-state small">No corporate selected.</div>`;
    return;
  }

  setText("detailsSubtitle", getCorporateName(item));

  const status = getCorporateStatus(item);

  body.innerHTML = `
    <div class="details-head">
      ${renderLogo(item)}
      <div class="row-text">
        <strong>${escapeHtml(getCorporateName(item))}</strong>
        <span>${escapeHtml(getCorporateCode(item))}</span>
      </div>
      <span class="status-chip ${statusClass(status)}">${escapeHtml(status)}</span>
    </div>

    ${detailLine("Contact Person", getContactName(item) || "-")}
    ${detailLine("Email", getContactEmail(item) || getCompanyEmail(item) || "-")}
    ${detailLine("Phone", getContactPhone(item) || getCompanyPhone(item) || "-")}
    ${detailLine("Property", getCorporatePropertyName(item))}
    ${detailLine("Contract Start", formatDate(getContractStartDate(item)))}
    ${detailLine("Contract End", formatDate(getContractEndDate(item)))}
    ${detailLine("Allotted Beds", getTotalBedsAllotted(item) || getSelectedBedIds(item).length || "-")}
    ${detailLine("Active Residents", getActiveResidentCount(item))}
    ${detailLine("Billing Cycle", getBillingCycle(item))}
    ${detailLine("Monthly Value", formatMoney(getMonthlyContractValue(item)))}
    ${detailLine("Security Deposit", formatMoney(getSecurityDeposit(item)))}
    ${detailLine("Outstanding", formatMoney(getTotalOutstanding(item)))}

    <div class="details-actions">
      <button class="primary-btn" type="button" data-open-corporate="${escapeHtml(item.id)}">
        <i class="fa-solid fa-up-right-from-square"></i>
        View Full Details
      </button>

      <button class="danger-btn" type="button" data-delete-corporate="${escapeHtml(item.id)}">
        <i class="fa-solid fa-trash"></i>
        Delete Corporate
      </button>
    </div>
  `;
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

/* ADD CORPORATE FORM */

function openCorporateModal() {
  const form = $("corporateForm");
  form?.reset();

  state.selectedBedIds.clear();

  const today = new Date();
  $("contractStartDateInput").value = formatDateInput(today);
  $("contractEndDateInput").value = formatDateInput(addDays(today, 365));
  $("noticePeriodDaysInput").value = "30";
  $("industryTypeInput").value = "Technology";
  $("billingCycleInput").value = "Monthly";
  $("paymentTermsInput").value = "Net 15 Days";
  $("corporateStatusInput").value = "Active";
  $("reservedForEmployeesInput").checked = true;

  fillPropertyOptions();
  refreshRoomAndBeds();
  renderFormSummary();

  openModal("corporateModal");
}

function fillPropertyOptions() {
  const propertyInput = $("corporatePropertyInput");
  if (!propertyInput) return;

  propertyInput.innerHTML = `<option value="">Select property</option>`;

  getPropertyOptions().forEach((property) => {
    const option = document.createElement("option");
    option.value = property.id;
    option.textContent = property.name;
    propertyInput.appendChild(option);
  });
}

function refreshRoomAndBeds() {
  const propertyInput = $("corporatePropertyInput");
  const roomTypeInput = $("roomTypeInput");

  if (!propertyInput || !roomTypeInput) return;

  const property = getPropertyOptions().find((item) => item.id === propertyInput.value) || null;

  state.selectedBedIds.clear();

  roomTypeInput.innerHTML = "";

  if (!property) {
    roomTypeInput.innerHTML = `<option value="">Select property first</option>`;
    renderAvailableBeds();
    renderFormSummary();
    return;
  }

  const roomTypes = availableRoomTypesFor(property.id, property.name);

  if (!roomTypes.length) {
    roomTypeInput.innerHTML = `<option value="">No available room type</option>`;
    renderAvailableBeds();
    renderFormSummary();
    return;
  }

  roomTypeInput.innerHTML = `<option value="">Choose room type</option>`;

  roomTypes.forEach((roomType) => {
    const option = document.createElement("option");
    option.value = roomType;
    option.textContent = roomType;
    roomTypeInput.appendChild(option);
  });

  renderAvailableBeds();
  renderFormSummary();
}

function renderAvailableBeds() {
  const picker = $("bedsPicker");
  if (!picker) return;

  const propertyId = $("corporatePropertyInput")?.value || "";
  const roomType = $("roomTypeInput")?.value || "";
  const property = getPropertyOptions().find((item) => item.id === propertyId) || null;

  setText("selectedBedsCount", `${state.selectedBedIds.size} selected`);

  if (!propertyId) {
    picker.innerHTML = "Select property first to view available beds.";
    return;
  }

  if (!roomType) {
    picker.innerHTML = "Select room type to view available beds.";
    return;
  }

  const beds = availableBedsFor(property.id, property.name, roomType);

  if (!beds.length) {
    picker.innerHTML = "No available beds found for this property and room type.";
    return;
  }

  picker.innerHTML = beds.map((bed) => {
    const selected = state.selectedBedIds.has(bed.id);

    return `
      <label class="bed-option ${selected ? "selected" : ""}">
        <input type="checkbox" data-bed-id="${escapeHtml(bed.id)}" ${selected ? "checked" : ""} />
        <div>
          <strong>Bed ${escapeHtml(bed.bedNo)}</strong>
          <span>Room ${escapeHtml(bed.roomNo || "-")} • ${escapeHtml(bed.roomType)}</span>
          <span>${escapeHtml(formatMoney(bed.monthlyRent))}</span>
        </div>
      </label>
    `;
  }).join("");
}

function getSelectedBedsForForm() {
  const propertyId = $("corporatePropertyInput")?.value || "";
  const roomType = $("roomTypeInput")?.value || "";
  const property = getPropertyOptions().find((item) => item.id === propertyId) || null;

  if (!property || !roomType) return [];

  return availableBedsFor(property.id, property.name, roomType)
    .filter((bed) => state.selectedBedIds.has(bed.id));
}

function renderFormSummary() {
  const name = $("corporateNameInput")?.value.trim() || "Corporate Name";
  const property = getPropertyOptions().find((item) => item.id === $("corporatePropertyInput")?.value);
  const selectedBeds = getSelectedBedsForForm();

  setText("summaryCorporateName", name);
  setText("summaryStatus", $("corporateStatusInput")?.value || "Active");
  setText("summaryContactPerson", $("contactPersonNameInput")?.value.trim() || "-");
  setText("summaryContactPhone", $("contactPhoneInput")?.value.trim() || "-");
  setText("summaryProperty", property?.name || "-");
  setText("summaryDates", `${formatDate($("contractStartDateInput")?.value)} - ${formatDate($("contractEndDateInput")?.value)}`);
  setText("summaryBeds", selectedBeds.length);
  setText("summaryOccupancy", $("roomTypeInput")?.value || "-");
  setText("summaryBillingCycle", $("billingCycleInput")?.value || "Monthly");
  setText("summaryMonthlyValue", formatMoney(numberValue($("monthlyContractValueInput")?.value)));
  setText("summaryDeposit", formatMoney(numberValue($("securityDepositInput")?.value)));

  const logo = $("summaryLogo");
  if (logo) logo.textContent = getInitials(name);
}

function generateCorporateCode(name, id) {
  const cleanName = String(name || "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .padEnd(4, "X")
    .slice(0, 4);

  const cleanId = String(id || "").toUpperCase().slice(0, 4);

  return `${cleanName}${cleanId}`;
}

function selectedBedToMap(bed) {
  return {
    bedId: bed.id,
    bedNo: bed.bedNo,
    bedName: bed.bedName,
    roomId: bed.roomId,
    roomNo: bed.roomNo,
    roomType: bed.roomType,
    propertyId: bed.propertyId,
    propertyName: bed.propertyName,
    monthlyRent: bed.monthlyRent
  };
}

async function saveCorporate(draft = false) {
  const form = $("corporateForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const propertyId = $("corporatePropertyInput").value;
  const property = getPropertyOptions().find((item) => item.id === propertyId) || null;
  const roomType = $("roomTypeInput").value;
  const selectedBeds = getSelectedBedsForForm();

  if (!property) {
    showToast("Select property first.", "error");
    return;
  }

  if (!roomType) {
    showToast("Select room type first.", "error");
    return;
  }

  if (!selectedBeds.length) {
    showToast("Select at least one available bed.", "error");
    return;
  }

  if (state.saving) return;

  state.saving = true;
  setSavingButtons(true, draft ? "Saving Draft..." : "Creating...");

  try {
    const corporateRef = doc(collection(db, COLLECTIONS.corporates));
    const contractRef = doc(collection(db, COLLECTIONS.corporateContracts));

    const corporateName = $("corporateNameInput").value.trim();
    const corporateStatus = draft ? "Draft" : $("corporateStatusInput").value;
    const contractStatus = draft ? "Draft" : $("corporateStatusInput").value;
    const corporateCode = generateCorporateCode(corporateName, corporateRef.id);
    const contractNumber = `CONT-${contractRef.id.slice(0, 8).toUpperCase()}`;

    const selectedBedIds = selectedBeds.map((bed) => bed.id);
    const selectedRoomIds = [...new Set(selectedBeds.map((bed) => bed.roomId).filter(Boolean))];
    const selectedBedMaps = selectedBeds.map(selectedBedToMap);
    const totalBedsAllotted = selectedBeds.length;
    const reservedForEmployees = $("reservedForEmployeesInput").checked;

    const batch = writeBatch(db);

    batch.set(corporateRef, {
      corporateId: corporateRef.id,
      corporateCode,
      corporateName,
      companyEmail: $("companyEmailInput").value.trim(),
      companyPhone: $("companyPhoneInput").value.trim(),
      industryType: $("industryTypeInput").value,
      gstNumber: $("gstNumberInput").value.trim(),
      corporateAddress: $("corporateAddressInput").value.trim(),
      companyLogoUrl: $("companyLogoUrlInput").value.trim(),

      contactPersonName: $("contactPersonNameInput").value.trim(),
      designation: $("designationInput").value.trim(),
      contactEmail: $("contactEmailInput").value.trim(),
      contactPhone: $("contactPhoneInput").value.trim(),
      alternateContactNumber: $("alternateContactNumberInput").value.trim(),

      propertyId: property.id,
      propertyName: property.name,
      selectedRoomIds,
      selectedBedIds,
      selectedBeds: selectedBedMaps,
      allottedBedIds: selectedBedIds,
      allottedBeds: selectedBedMaps,
      reservedBedCount: totalBedsAllotted,
      totalBedsAllotted,
      activeResidents: 0,

      roomType,
      occupancyType: roomType,
      reservedForEmployees,

      billingCycle: $("billingCycleInput").value,
      paymentTerms: $("paymentTermsInput").value,
      securityDeposit: numberValue($("securityDepositInput").value),
      monthlyContractValue: numberValue($("monthlyContractValueInput").value),
      totalOutstanding: 0,

      latestContractId: contractRef.id,
      latestContractNumber: contractNumber,
      latestContractStatus: contractStatus,
      contractStartDate: inputDateToTimestamp($("contractStartDateInput").value),
      contractEndDate: inputDateToTimestamp($("contractEndDateInput").value),
      noticePeriodDays: integerValue($("noticePeriodDaysInput").value),
      agreementUrl: $("agreementUrlInput").value.trim(),
      notes: $("notesInput").value.trim(),

      status: corporateStatus,
      corporateStatus,
      isActive: corporateStatus === "Active",
      source: "admin_website",
      createdBy: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(contractRef, {
      contractId: contractRef.id,
      contractNumber,
      corporateId: corporateRef.id,
      corporateCode,
      corporateName,
      propertyId: property.id,
      propertyName: property.name,
      selectedRoomIds,
      selectedBedIds,
      selectedBeds: selectedBedMaps,
      allottedBedIds: selectedBedIds,
      allottedBeds: selectedBedMaps,
      reservedBedCount: totalBedsAllotted,
      startDate: inputDateToTimestamp($("contractStartDateInput").value),
      endDate: inputDateToTimestamp($("contractEndDateInput").value),
      noticePeriodDays: integerValue($("noticePeriodDaysInput").value),
      billingCycle: $("billingCycleInput").value,
      paymentTerms: $("paymentTermsInput").value,
      securityDeposit: numberValue($("securityDepositInput").value),
      monthlyContractValue: numberValue($("monthlyContractValueInput").value),
      totalBedsAllotted,
      activeResidents: 0,
      roomType,
      occupancyType: roomType,
      reservedForEmployees,
      agreementUrl: $("agreementUrlInput").value.trim(),
      notes: $("notesInput").value.trim(),
      status: contractStatus,
      contractStatus,
      isActive: contractStatus === "Active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    selectedBeds.forEach((bed) => {
      batch.set(
        doc(db, COLLECTIONS.beds, bed.id),
        {
          corporateId: corporateRef.id,
          corporateName,
          corporateCode,
          corporateContractId: contractRef.id,
          corporateContractNumber: contractNumber,
          reservedForCorporate: true,
          corporateReserved: true,
          reservationStatus: "Reserved",
          reservedForEmployees,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });

    await batch.commit();

    showToast(draft ? "Corporate draft saved successfully." : "Corporate created successfully.");
    closeModal("corporateModal");
  } catch (error) {
    console.error("Save corporate failed:", error);
    showToast(`Failed to save corporate: ${error.message}`, "error");
  } finally {
    state.saving = false;
    setSavingButtons(false);
  }
}

function setSavingButtons(disabled, text = "") {
  const createBtn = $("createCorporateBtn");
  const draftBtn = $("saveDraftBtn");

  if (createBtn) {
    createBtn.disabled = disabled;
    createBtn.innerHTML = disabled
      ? `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(text || "Saving...")}`
      : `<i class="fa-solid fa-check"></i> Create Corporate`;
  }

  if (draftBtn) {
    draftBtn.disabled = disabled;
  }
}

/* ACTIONS */

async function updateCorporateStatus(corporateId, status) {
  try {
    await setDoc(
      doc(db, COLLECTIONS.corporates, corporateId),
      {
        status,
        corporateStatus: status,
        isActive: status === "Active",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast(`Corporate status updated to ${status}.`);
  } catch (error) {
    console.error("Corporate status update failed:", error);
    showToast(`Failed to update corporate status: ${error.message}`, "error");
  }
}

async function updateContractStatus(contractId, status) {
  try {
    await setDoc(
      doc(db, COLLECTIONS.corporateContracts, contractId),
      {
        status,
        contractStatus: status,
        isActive: status === "Active",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast(`Contract status updated to ${status}.`);
  } catch (error) {
    console.error("Contract status update failed:", error);
    showToast(`Failed to update contract status: ${error.message}`, "error");
  }
}

async function deleteCorporate(corporateId) {
  const corporate = state.corporates.find((item) => item.id === corporateId);
  if (!corporate) return;

  const name = getCorporateName(corporate);

  const confirmed = window.confirm(
    `Delete Corporate?\n\nThis will permanently delete ${name} and its linked corporate contracts. Resident records will not be deleted.`
  );

  if (!confirmed) return;

  try {
    const dbBatch = writeBatch(db);

    const contractsSnap = await getDocs(
      query(
        collection(db, COLLECTIONS.corporateContracts),
        where("corporateId", "==", corporateId)
      )
    );

    contractsSnap.docs.forEach((contractDoc) => {
      dbBatch.delete(contractDoc.ref);
    });

    dbBatch.delete(doc(db, COLLECTIONS.corporates, corporateId));

    await dbBatch.commit();

    if (state.selectedCorporateId === corporateId) {
      state.selectedCorporateId = "";
    }

    showToast(`${name} deleted successfully.`);
    closeModal("detailsModal");
  } catch (error) {
    console.error("Delete corporate failed:", error);
    showToast(`Failed to delete corporate: ${error.message}`, "error");
  }
}

/* DETAILS MODAL */

function openDetailsModal(corporateId) {
  const item = state.corporates.find((corporate) => corporate.id === corporateId);
  if (!item) return;

  state.selectedDetailsId = corporateId;

  setText("detailsModalTitle", getCorporateName(item));
  setText("detailsModalSubtitle", getCorporateCode(item));

  const body = $("detailsModalBody");
  if (!body) return;

  body.innerHTML = `
    <h3>Corporate Information</h3>
    ${detailLine("Status", getCorporateStatus(item))}
    ${detailLine("Industry", getIndustryType(item))}
    ${detailLine("Company Email", getCompanyEmail(item) || "-")}
    ${detailLine("Company Phone", getCompanyPhone(item) || "-")}
    ${detailLine("GST Number", getGstNumber(item) || "-")}
    ${detailLine("Corporate Address", getCorporateAddress(item) || "-")}

    <h3 style="margin-top:18px;">Contact Person</h3>
    ${detailLine("Contact Person", getContactName(item) || "-")}
    ${detailLine("Designation", getDesignation(item) || "-")}
    ${detailLine("Contact Email", getContactEmail(item) || "-")}
    ${detailLine("Contact Phone", getContactPhone(item) || "-")}
    ${detailLine("Alternate Phone", getAlternatePhone(item) || "-")}

    <h3 style="margin-top:18px;">Contract Details</h3>
    ${detailLine("Property", getCorporatePropertyName(item))}
    ${detailLine("Room Type", getRoomType(item))}
    ${detailLine("Occupancy Type", getOccupancyType(item))}
    ${detailLine("Beds Allotted", getTotalBedsAllotted(item) || getSelectedBedIds(item).length || "-")}
    ${detailLine("Active Residents", getActiveResidentCount(item))}
    ${detailLine("Reserved For Employees", getReservedForEmployees(item) ? "Yes" : "No")}
    ${detailLine("Contract Start", formatDate(getContractStartDate(item)))}
    ${detailLine("Contract End", formatDate(getContractEndDate(item)))}
    ${detailLine("Notice Period", `${getNoticePeriodDays(item) || 30} Days`)}
    ${detailLine("Billing Cycle", getBillingCycle(item))}
    ${detailLine("Payment Terms", getPaymentTerms(item))}
    ${detailLine("Monthly Contract Value", formatMoney(getMonthlyContractValue(item)))}
    ${detailLine("Security Deposit", formatMoney(getSecurityDeposit(item)))}
    ${detailLine("Outstanding", formatMoney(getTotalOutstanding(item)))}

    <h3 style="margin-top:18px;">Links & Notes</h3>
    ${detailLine("Agreement URL", getAgreementUrl(item) || "-")}
    ${detailLine("Logo URL", getCompanyLogo(item) || "-")}
    ${detailLine("Notes", getNotes(item) || "No notes added.")}

    <div class="details-actions">
      <select class="status-select" data-change-corporate-status="${escapeHtml(item.id)}">
        ${CORPORATE_STATUSES.map((value) => `
          <option value="${escapeHtml(value)}" ${value === getCorporateStatus(item) ? "selected" : ""}>
            ${escapeHtml(value)}
          </option>
        `).join("")}
      </select>

      <button class="danger-btn" type="button" data-delete-corporate="${escapeHtml(item.id)}">
        <i class="fa-solid fa-trash"></i>
        Delete Corporate
      </button>
    </div>
  `;

  openModal("detailsModal");
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

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Corporate Management refreshed.");
  });

  $("addCorporateBtn")?.addEventListener("click", openCorporateModal);

  $("corporateForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCorporate(false);
  });

  $("saveDraftBtn")?.addEventListener("click", () => {
    saveCorporate(true);
  });

  $("corporatePropertyInput")?.addEventListener("change", refreshRoomAndBeds);

  $("roomTypeInput")?.addEventListener("change", () => {
    state.selectedBedIds.clear();
    renderAvailableBeds();
    renderFormSummary();
  });

  $("bedsPicker")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-bed-id]");
    if (!checkbox) return;

    if (checkbox.checked) {
      state.selectedBedIds.add(checkbox.dataset.bedId);
    } else {
      state.selectedBedIds.delete(checkbox.dataset.bedId);
    }

    renderAvailableBeds();
    renderFormSummary();
  });

  [
    "corporateNameInput",
    "companyPhoneInput",
    "contactPersonNameInput",
    "contactPhoneInput",
    "contractStartDateInput",
    "contractEndDateInput",
    "billingCycleInput",
    "securityDepositInput",
    "monthlyContractValueInput",
    "corporateStatusInput"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", renderFormSummary);
    el.addEventListener("change", renderFormSummary);
  });

  [
    "globalSearchInput",
    "corporateSearchInput",
    "statusFilter",
    "propertyFilter",
    "contractFilter"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", renderCorporateList);
    el.addEventListener("change", renderCorporateList);
  });

  $("resetFiltersBtn")?.addEventListener("click", () => {
    if ($("globalSearchInput")) $("globalSearchInput").value = "";
    if ($("corporateSearchInput")) $("corporateSearchInput").value = "";
    if ($("statusFilter")) $("statusFilter").value = "All Status";
    if ($("propertyFilter")) $("propertyFilter").value = "All Properties";
    if ($("contractFilter")) $("contractFilter").value = "All Contracts";

    renderCorporateList();
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
    const selectCorporate = event.target.closest("[data-select-corporate]");
    if (selectCorporate && !event.target.closest("button") && !event.target.closest("select")) {
      state.selectedCorporateId = selectCorporate.dataset.selectCorporate;
      renderCorporateList();
      return;
    }

    const openBtn = event.target.closest("[data-open-corporate]");
    if (openBtn) {
      event.stopPropagation();
      openDetailsModal(openBtn.dataset.openCorporate);
      return;
    }

    const deleteBtn = event.target.closest("[data-delete-corporate]");
    if (deleteBtn) {
      event.stopPropagation();
      await deleteCorporate(deleteBtn.dataset.deleteCorporate);
      return;
    }
  });

  document.addEventListener("change", async (event) => {
    const corporateStatus = event.target.closest("[data-change-corporate-status]");
    if (corporateStatus) {
      await updateCorporateStatus(corporateStatus.dataset.changeCorporateStatus, corporateStatus.value);
      return;
    }

    const contractStatus = event.target.closest("[data-change-contract-status]");
    if (contractStatus) {
      await updateContractStatus(contractStatus.dataset.changeContractStatus, contractStatus.value);
    }
  });

  $("deleteFromModalBtn")?.addEventListener("click", async () => {
    if (!state.selectedDetailsId) return;
    await deleteCorporate(state.selectedDetailsId);
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});