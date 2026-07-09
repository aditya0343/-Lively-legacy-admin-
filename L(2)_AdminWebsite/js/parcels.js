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
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  parcels: "parcels",
  residents: "residents",
  users: "users",
  properties: "properties"
};

const COLORS = {
  navy: "#061b32",
  gold: "#b68b2d",
  green: "#2e8a4e",
  red: "#7a1024",
  orange: "#e18a00",
  purple: "#6352c7",
  blue: "#2f80ed"
};

const PARCEL_STATUSES = [
  "Requested",
  "Received by Staff",
  "Ready for Pickup",
  "Handed Over to Resident",
  "Returned"
];

const PARCEL_TYPES = [
  "Document",
  "Shopping",
  "Food Delivery",
  "Electronics",
  "Clothing",
  "Gift",
  "Medicine",
  "Other"
];

const state = {
  parcels: [],
  residents: [],
  users: [],
  properties: [],
  savingParcel: false,
  unsubscribers: []
};

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
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

function firstPresent(values, fallback = "") {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
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

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function dateInputValue(value = new Date()) {
  const date = toDate(value) || new Date();
  return date.toISOString().slice(0, 10);
}

function timeInputValue(value = new Date()) {
  const date = toDate(value) || new Date();

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function fromDateAndTime(dateValue, timeValue) {
  const date = dateValue || dateInputValue(new Date());
  const time = timeValue || timeInputValue(new Date());

  const merged = new Date(`${date}T${time}:00`);
  return Number.isNaN(merged.getTime()) ? new Date() : merged;
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

/* -----------------------------
   Property + Resident Helpers
------------------------------ */

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

function findProperty(id) {
  return getPropertyOptions().find((property) => property.id === id) || null;
}

function getResidentOptions() {
  const propertyMap = getPropertyMap();
  const map = new Map();

  state.residents.forEach((resident) => {
    const propertyId = firstNonEmpty([resident.propertyId, resident.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(resident.id, {
      id: resident.id,
      name: firstNonEmpty([resident.name, resident.fullName, resident.residentName], resident.id),
      phone: firstNonEmpty([resident.phone, resident.mobile], ""),
      email: firstNonEmpty([resident.email], ""),
      roomNo: firstNonEmpty([resident.roomNo, resident.roomNumber, resident.bedNo], ""),
      propertyId,
      propertyName: firstNonEmpty([resident.propertyName, resident.property], property?.name || "")
    });
  });

  state.users.forEach((user) => {
    if (map.has(user.id)) return;

    const role = normalize(user.role || user.userRole || user.type);
    const looksResident = !role || ["resident", "tenant", "student"].includes(role);

    if (!looksResident) return;

    const propertyId = firstNonEmpty([user.propertyId, user.property_id], "");
    const property = propertyMap.get(propertyId);

    map.set(user.id, {
      id: user.id,
      name: firstNonEmpty([user.name, user.fullName, user.displayName], user.id),
      phone: firstNonEmpty([user.phone, user.mobile], ""),
      email: firstNonEmpty([user.email], ""),
      roomNo: firstNonEmpty([user.roomNo, user.roomNumber, user.bedNo], ""),
      propertyId,
      propertyName: firstNonEmpty([user.propertyName, user.property], property?.name || "")
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findResident(id) {
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

/* -----------------------------
   Parcel Mappers
------------------------------ */

function normalizeParcelStatus(value) {
  const clean = normalize(value).replaceAll("_", " ").replaceAll("-", " ");

  if (clean === "requested" || clean === "request") return "Requested";

  if (
    clean === "received by staff" ||
    clean === "received" ||
    clean === "pending"
  ) {
    return "Received by Staff";
  }

  if (clean === "ready for pickup") return "Ready for Pickup";

  if (
    clean === "handed over to resident" ||
    clean === "handed over" ||
    clean === "delivered" ||
    clean === "collected"
  ) {
    return "Handed Over to Resident";
  }

  if (clean === "returned" || clean === "return" || clean === "cancelled") {
    return "Returned";
  }

  return "Requested";
}

function normalizeParcelType(value) {
  const clean = String(value || "").trim();
  if (!clean) return "Document";

  const lower = clean.toLowerCase();

  if (lower === "document") return "Document";
  if (lower === "shopping") return "Shopping";
  if (lower === "food delivery" || lower === "food") return "Food Delivery";
  if (lower === "electronics") return "Electronics";
  if (lower === "clothing" || lower === "cloth") return "Clothing";
  if (lower === "gift") return "Gift";
  if (lower === "medicine") return "Medicine";
  if (lower === "other") return "Other";

  return titleCase(clean);
}

function getTrackingId(parcel) {
  return firstNonEmpty(
    [parcel.trackingId, parcel.trackingNo, parcel.trackingNumber, parcel.awbNumber, parcel.parcelNo, parcel.parcelId],
    parcel.id
  );
}

function getParcelResidentId(parcel) {
  return firstNonEmpty([parcel.residentId, parcel.userId, parcel.tenantId, parcel.residentDocId], "");
}

function getParcelResident(parcel) {
  const id = getParcelResidentId(parcel);
  return getResidentOptions().find((resident) => resident.id === id) || null;
}

function getParcelResidentName(parcel) {
  const resident = getParcelResident(parcel);

  return firstNonEmpty(
    [parcel.residentName, parcel.tenantName, parcel.name],
    resident?.name || "Resident"
  );
}

function getParcelResidentPhone(parcel) {
  const resident = getParcelResident(parcel);

  return firstNonEmpty(
    [parcel.residentPhone, parcel.phone, parcel.mobile],
    resident?.phone || ""
  );
}

function getParcelResidentEmail(parcel) {
  const resident = getParcelResident(parcel);

  return firstNonEmpty(
    [parcel.residentEmail, parcel.email],
    resident?.email || ""
  );
}

function getParcelRoomNo(parcel) {
  const resident = getParcelResident(parcel);

  return firstNonEmpty(
    [parcel.roomNo, parcel.roomNumber, parcel.bedNo, parcel.unit, parcel.bedNumber],
    resident?.roomNo || ""
  );
}

function getParcelPropertyId(parcel) {
  return firstNonEmpty([parcel.propertyId, parcel.property_id, parcel.propertyDocId, parcel.propertyCode], "");
}

function getParcelPropertyName(parcel) {
  const propertyMap = getPropertyMap();
  const resident = getParcelResident(parcel);
  const propertyId = getParcelPropertyId(parcel);
  const property = propertyMap.get(propertyId);

  return firstNonEmpty(
    [parcel.propertyName, parcel.property],
    property?.name || resident?.propertyName || "No Property"
  );
}

function getCourierName(parcel) {
  return firstNonEmpty([parcel.courierName, parcel.courier, parcel.deliveryPartner, parcel.company], "Courier");
}

function getParcelType(parcel) {
  return normalizeParcelType(firstNonEmpty([parcel.parcelType, parcel.type, parcel.category], "Document"));
}

function getParcelStatus(parcel) {
  return normalizeParcelStatus(firstNonEmpty([parcel.status, parcel.parcelStatus, parcel.deliveryStatus], "Requested"));
}

function getReceivedByStaffName(parcel) {
  return firstNonEmpty([parcel.receivedByStaffName, parcel.receivedBy], "");
}

function getHandedOverToName(parcel) {
  return firstNonEmpty([parcel.handedOverToName, parcel.deliveredTo], "");
}

function getParcelNotes(parcel) {
  return firstNonEmpty([parcel.notes, parcel.message], "");
}

function getParcelSource(parcel) {
  return firstNonEmpty([parcel.source], "admin_app");
}

function getRequestedAt(parcel) {
  return firstPresent([parcel.requestedAt], "");
}

function getReceivedAt(parcel) {
  return firstPresent([parcel.receivedAt, parcel.receivedByStaffAt, parcel.receivedOn, parcel.receivedDate], "");
}

function getReadyForPickupAt(parcel) {
  return firstPresent([parcel.readyForPickupAt], "");
}

function getHandedOverAt(parcel) {
  return firstPresent([parcel.handedOverAt, parcel.deliveredAt], "");
}

function getReturnedAt(parcel) {
  return firstPresent([parcel.returnedAt], "");
}

function getCreatedAt(parcel) {
  return firstPresent([parcel.createdAt], "");
}

function getBestParcelDate(parcel) {
  return firstPresent(
    [
      getReceivedAt(parcel),
      getRequestedAt(parcel),
      getHandedOverAt(parcel),
      getReturnedAt(parcel),
      getCreatedAt(parcel)
    ],
    ""
  );
}

function statusClass(value) {
  return normalize(value).replaceAll(" ", "-");
}

/* -----------------------------
   Auth + Layout
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
   Firebase
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
  listenCollection("parcels", COLLECTIONS.parcels);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("users", COLLECTIONS.users);
}

/* -----------------------------
   Render
------------------------------ */

function renderPage() {
  renderFilterOptions();
  renderStats();
  renderParcelList();
  renderParcelOverview();
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
    ...new Set(state.parcels.map(getParcelPropertyName).filter(Boolean))
  ];

  updateSelect("propertyFilter", properties);
  updateSelect("statusFilter", ["All Status", ...PARCEL_STATUSES]);
  updateSelect("parcelTypeFilter", ["All Parcel Type", ...PARCEL_TYPES]);
}

function getSummary() {
  const totalParcels = state.parcels.length;

  const requested = state.parcels.filter((item) => getParcelStatus(item) === "Requested").length;
  const receivedByStaff = state.parcels.filter((item) => getParcelStatus(item) === "Received by Staff").length;
  const readyForPickup = state.parcels.filter((item) => getParcelStatus(item) === "Ready for Pickup").length;
  const handedOver = state.parcels.filter((item) => getParcelStatus(item) === "Handed Over to Resident").length;
  const returned = state.parcels.filter((item) => getParcelStatus(item) === "Returned").length;

  return {
    totalParcels,
    requested,
    receivedByStaff,
    readyForPickup,
    handedOver,
    returned
  };
}

function renderStats() {
  const summary = getSummary();

  setText("totalParcelsValue", summary.totalParcels);
  setText("requestedValue", summary.requested);
  setText("receivedByStaffValue", summary.receivedByStaff);
  setText("readyForPickupValue", summary.readyForPickup);
  setText("handedOverValue", summary.handedOver);
  setText("returnedValue", summary.returned);
}

function getFilteredParcels() {
  let parcels = [...state.parcels];

  const globalSearch = normalize($("globalSearchInput")?.value);
  const localSearch = normalize($("parcelSearchInput")?.value);
  const search = localSearch || globalSearch;

  const propertyFilter = $("propertyFilter")?.value || "All Properties";
  const statusFilter = $("statusFilter")?.value || "All Status";
  const parcelTypeFilter = $("parcelTypeFilter")?.value || "All Parcel Type";
  const sortFilter = $("sortFilter")?.value || "Recently Added";

  if (search) {
    parcels = parcels.filter((parcel) => {
      const haystack = [
        getTrackingId(parcel),
        getParcelResidentName(parcel),
        getParcelResidentPhone(parcel),
        getParcelRoomNo(parcel),
        getParcelPropertyName(parcel),
        getCourierName(parcel),
        getParcelType(parcel),
        getParcelStatus(parcel),
        formatDateTime(getBestParcelDate(parcel))
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (propertyFilter !== "All Properties") {
    parcels = parcels.filter((parcel) => getParcelPropertyName(parcel) === propertyFilter);
  }

  if (statusFilter !== "All Status") {
    parcels = parcels.filter((parcel) => getParcelStatus(parcel) === statusFilter);
  }

  if (parcelTypeFilter !== "All Parcel Type") {
    parcels = parcels.filter((parcel) => getParcelType(parcel) === parcelTypeFilter);
  }

  parcels.sort((a, b) => {
    if (sortFilter === "Tracking ID") {
      return getTrackingId(a).localeCompare(getTrackingId(b));
    }

    if (sortFilter === "Resident A-Z") {
      return getParcelResidentName(a).localeCompare(getParcelResidentName(b));
    }

    if (sortFilter === "Received Time") {
      const aTime = toDate(getReceivedAt(a) || getCreatedAt(a))?.getTime() || 0;
      const bTime = toDate(getReceivedAt(b) || getCreatedAt(b))?.getTime() || 0;
      return bTime - aTime;
    }

    if (sortFilter === "Status") {
      return getParcelStatus(a).localeCompare(getParcelStatus(b));
    }

    const aCreated = toDate(getCreatedAt(a))?.getTime() || 0;
    const bCreated = toDate(getCreatedAt(b))?.getTime() || 0;
    return bCreated - aCreated;
  });

  return parcels;
}

function renderParcelList() {
  const container = $("parcelList");
  if (!container) return;

  const parcels = getFilteredParcels();

  setText("parcelListSubText", `${parcels.length} parcel records shown`);

  if (!parcels.length) {
    container.innerHTML = `
      <div class="empty-state">
        No parcels found. Parcel requests from resident app or admin entries will appear here.
      </div>
    `;
    return;
  }

  container.innerHTML = parcels.map((parcel) => {
    const status = getParcelStatus(parcel);
    const type = getParcelType(parcel);

    return `
      <article class="parcel-row-card">
        <div class="avatar-box">${escapeHtml(getInitials(getParcelResidentName(parcel)))}</div>

        <div class="row-text">
          <strong>${escapeHtml(getTrackingId(parcel))}</strong>
          <span>${escapeHtml(getCourierName(parcel))}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getParcelResidentName(parcel))}</strong>
          <span>${escapeHtml(getParcelRoomNo(parcel) || getParcelResidentPhone(parcel) || "Resident")}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(getParcelPropertyName(parcel))}</strong>
          <span>${escapeHtml(type)}</span>
        </div>

        <div class="row-text desktop-col">
          <strong>${escapeHtml(formatDateTime(getReceivedAt(parcel) || getCreatedAt(parcel)))}</strong>
          <span>${escapeHtml(getReceivedByStaffName(parcel) ? `By ${getReceivedByStaffName(parcel)}` : "Staff not added")}</span>
        </div>

        <span class="tiny-chip ${statusClass(status)}">${escapeHtml(status)}</span>

        <div class="row-actions">
          <button type="button" title="View Details" data-view-parcel="${escapeHtml(parcel.id)}">
            <i class="fa-regular fa-eye"></i>
          </button>

          <select data-status-parcel="${escapeHtml(parcel.id)}" title="Change Status">
            ${PARCEL_STATUSES.map((item) => `
              <option value="${escapeHtml(item)}" ${status === item ? "selected" : ""}>
                ${escapeHtml(item)}
              </option>
            `).join("")}
          </select>
        </div>
      </article>
    `;
  }).join("");
}

function renderParcelOverview() {
  const container = $("parcelOverviewList");
  if (!container) return;

  const summary = getSummary();

  const rows = [
    ["Total Parcels", summary.totalParcels, COLORS.navy],
    ["Requested", summary.requested, COLORS.blue],
    ["Received by Staff", summary.receivedByStaff, COLORS.orange],
    ["Ready for Pickup", summary.readyForPickup, COLORS.purple],
    ["Handed Over", summary.handedOver, COLORS.green],
    ["Returned", summary.returned, COLORS.red]
  ];

  container.innerHTML = rows.map(([label, value, color]) => {
    return `
      <div class="overview-line">
        <span>
          <i class="fa-solid fa-circle" style="color:${color}"></i>
          ${escapeHtml(label)}
        </span>
        <strong style="color:${color}">${value}</strong>
      </div>
    `;
  }).join("");
}

/* -----------------------------
   Add Parcel
------------------------------ */

function resetParcelForm() {
  $("parcelForm")?.reset();

  fillResidentSelect();
  fillPropertySelect();

  $("courierInput").value = "Amazon Logistics";
  $("parcelTypeInput").value = "Document";
  $("parcelStatusInput").value = "Received by Staff";
  $("receivedDateInput").value = dateInputValue(new Date());
  $("receivedTimeInput").value = timeInputValue(new Date());
}

function fillResidentSelect() {
  const select = $("parcelResidentInput");
  if (!select) return;

  const residents = getResidentOptions();

  select.innerHTML = `<option value="">Select resident</option>`;

  residents.forEach((resident) => {
    const option = document.createElement("option");
    option.value = resident.id;
    option.textContent = `${resident.name}${resident.roomNo ? ` • ${resident.roomNo}` : resident.phone ? ` • ${resident.phone}` : ""}`;
    select.appendChild(option);
  });
}

function fillPropertySelect() {
  const select = $("parcelPropertyInput");
  if (!select) return;

  const properties = getPropertyOptions();

  select.innerHTML = `<option value="">Select property</option>`;

  properties.forEach((property) => {
    const option = document.createElement("option");
    option.value = property.id;
    option.textContent = property.name;
    select.appendChild(option);
  });
}

function openAddParcelModal() {
  resetParcelForm();
  openModal("parcelModal");
}

async function saveParcel(event) {
  event.preventDefault();

  if (state.savingParcel) return;

  const form = $("parcelForm");
  if (!form?.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const resident = findResident($("parcelResidentInput").value);
  const property = findProperty($("parcelPropertyInput").value);

  if (!resident || !property) {
    showToast("Selected resident or property not found.", "error");
    return;
  }

  state.savingParcel = true;
  $("saveParcelBtn").disabled = true;
  $("saveParcelBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const ref = doc(collection(db, COLLECTIONS.parcels));
    const cleanTrackingId = $("trackingIdInput").value.trim() || `TRK${ref.id.slice(0, 8).toUpperCase()}`;
    const status = $("parcelStatusInput").value;
    const receivedDateTime = fromDateAndTime($("receivedDateInput").value, $("receivedTimeInput").value);

    const data = {
      parcelId: ref.id,
      trackingId: cleanTrackingId,
      residentId: resident.id,
      residentName: resident.name,
      residentPhone: resident.phone,
      residentEmail: resident.email,
      roomNo: resident.roomNo,
      propertyId: property.id,
      propertyName: property.name,
      courierName: $("courierInput").value.trim(),
      parcelType: $("parcelTypeInput").value,
      status,
      parcelStatus: status,
      receivedByStaffName: $("receivedByStaffInput").value.trim(),
      handedOverToName: $("handedOverToInput").value.trim(),
      notes: $("parcelNotesInput").value.trim(),
      receivedAt: Timestamp.fromDate(receivedDateTime),
      source: "admin_website",
      createdBy: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (status === "Requested") data.requestedAt = Timestamp.fromDate(receivedDateTime);
    if (status === "Received by Staff") data.receivedByStaffAt = Timestamp.fromDate(receivedDateTime);
    if (status === "Ready for Pickup") data.readyForPickupAt = Timestamp.fromDate(receivedDateTime);
    if (status === "Handed Over to Resident") data.handedOverAt = Timestamp.fromDate(receivedDateTime);
    if (status === "Returned") data.returnedAt = Timestamp.fromDate(receivedDateTime);

    await setDoc(ref, data);

    showToast("Parcel saved successfully.");
    closeModal("parcelModal");
  } catch (error) {
    console.error("Save parcel failed:", error);
    showToast(`Failed to save parcel: ${error.message}`, "error");
  } finally {
    state.savingParcel = false;
    $("saveParcelBtn").disabled = false;
    $("saveParcelBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Parcel`;
  }
}

/* -----------------------------
   Status + Detail
------------------------------ */

async function updateParcelStatus(id, status) {
  const parcel = state.parcels.find((item) => item.id === id);

  try {
    const data = {
      status,
      parcelStatus: status,
      updatedAt: serverTimestamp()
    };

    if (status === "Requested") data.requestedAt = serverTimestamp();

    if (status === "Received by Staff") {
      data.receivedByStaffAt = serverTimestamp();
      data.receivedAt = serverTimestamp();
    }

    if (status === "Ready for Pickup") data.readyForPickupAt = serverTimestamp();

    if (status === "Handed Over to Resident") {
      data.handedOverAt = serverTimestamp();
      data.deliveredAt = serverTimestamp();
    }

    if (status === "Returned") data.returnedAt = serverTimestamp();

    await setDoc(doc(db, COLLECTIONS.parcels, id), data, { merge: true });

    showToast(`${parcel ? getTrackingId(parcel) : "Parcel"} marked as ${status}.`);
  } catch (error) {
    console.error("Parcel status update failed:", error);
    showToast(`Failed to update parcel: ${error.message}`, "error");
  }
}

function openParcelDetail(id) {
  const parcel = state.parcels.find((item) => item.id === id);
  if (!parcel) return;

  setText("detailParcelTitle", getTrackingId(parcel));
  setText("detailParcelSub", getCourierName(parcel));

  const content = $("parcelDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="detail-grid">
      ${detailLine("Resident", getParcelResidentName(parcel))}
      ${detailLine("Resident Phone", getParcelResidentPhone(parcel) || "-")}
      ${detailLine("Resident Email", getParcelResidentEmail(parcel) || "-")}
      ${detailLine("Room / Bed", getParcelRoomNo(parcel) || "-")}
      ${detailLine("Property", getParcelPropertyName(parcel))}
      ${detailLine("Courier", getCourierName(parcel))}
      ${detailLine("Parcel Type", getParcelType(parcel))}
      ${detailLine("Status", getParcelStatus(parcel))}
      ${detailLine("Requested At", formatDateTime(getRequestedAt(parcel)))}
      ${detailLine("Received On", formatDateTime(getReceivedAt(parcel)))}
      ${detailLine("Ready for Pickup", formatDateTime(getReadyForPickupAt(parcel)))}
      ${detailLine("Handed Over At", formatDateTime(getHandedOverAt(parcel)))}
      ${detailLine("Returned At", formatDateTime(getReturnedAt(parcel)))}
      ${detailLine("Received by Staff", getReceivedByStaffName(parcel) || "-")}
      ${detailLine("Handed Over To", getHandedOverToName(parcel) || getParcelResidentName(parcel))}
      ${detailLine("Source", getParcelSource(parcel))}
    </div>

    <div class="detail-note">
      <strong>Notes</strong><br>
      ${escapeHtml(getParcelNotes(parcel) || "No notes added.")}
    </div>

    <div class="detail-actions">
      <button type="button" class="gold-action" data-detail-status="${escapeHtml(parcel.id)}" data-status-value="Received by Staff">
        Received
      </button>

      <button type="button" class="purple-action" data-detail-status="${escapeHtml(parcel.id)}" data-status-value="Ready for Pickup">
        Ready
      </button>

      <button type="button" class="green-action" data-detail-status="${escapeHtml(parcel.id)}" data-status-value="Handed Over to Resident">
        Handed Over
      </button>

      <button type="button" class="red-action" data-detail-status="${escapeHtml(parcel.id)}" data-status-value="Returned">
        Returned
      </button>
    </div>
  `;

  openModal("parcelDetailModal");
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

/* -----------------------------
   Colors
------------------------------ */

function statusColor(value) {
  const clean = normalizeParcelStatus(value);

  if (clean === "Requested") return COLORS.blue;
  if (clean === "Received by Staff") return COLORS.orange;
  if (clean === "Ready for Pickup") return COLORS.purple;
  if (clean === "Handed Over to Resident") return COLORS.green;
  if (clean === "Returned") return COLORS.red;

  return COLORS.navy;
}

/* -----------------------------
   Modal
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
   Events
------------------------------ */

function setupEvents() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Parcels refreshed.");
  });

  $("openParcelModalBtn")?.addEventListener("click", openAddParcelModal);

  $("parcelForm")?.addEventListener("submit", saveParcel);

  $("parcelResidentInput")?.addEventListener("change", () => {
    const resident = findResident($("parcelResidentInput").value);

    if (resident && resident.propertyId) {
      $("parcelPropertyInput").value = resident.propertyId;
    }

    if (resident && !$("handedOverToInput").value.trim()) {
      $("handedOverToInput").value = resident.name;
    }
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

  [
    "globalSearchInput",
    "parcelSearchInput",
    "propertyFilter",
    "statusFilter",
    "parcelTypeFilter",
    "sortFilter"
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", renderParcelList);
    element.addEventListener("change", renderParcelList);
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("globalSearchInput").value = "";
    $("parcelSearchInput").value = "";
    $("propertyFilter").value = "All Properties";
    $("statusFilter").value = "All Status";
    $("parcelTypeFilter").value = "All Parcel Type";
    $("sortFilter").value = "Recently Added";

    renderParcelList();
  });

  $("parcelList")?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view-parcel]");
    if (!viewButton) return;

    openParcelDetail(viewButton.dataset.viewParcel);
  });

  $("parcelList")?.addEventListener("change", (event) => {
    const statusSelect = event.target.closest("[data-status-parcel]");
    if (!statusSelect) return;

    updateParcelStatus(statusSelect.dataset.statusParcel, statusSelect.value);
  });

  $("parcelDetailContent")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail-status]");
    if (!button) return;

    updateParcelStatus(button.dataset.detailStatus, button.dataset.statusValue);
    closeModal("parcelDetailModal");
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