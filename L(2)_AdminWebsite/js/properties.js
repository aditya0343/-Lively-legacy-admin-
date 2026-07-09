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
  GeoPoint,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const GEOAPIFY_API_KEY = "19412ab41d684adaa94cbee4b8185486";

const COLLECTIONS = {
  properties: "properties",
  propertyImages: "property_images",
  rooms: "rooms",
  beds: "beds",
  bookings: "bookings",
  payments: "payments",
  transactions: "transactions",
  invoices: "invoices",
  residents: "residents",
  activityLogs: "activity_logs"
};

const state = {
  properties: [],
  rooms: [],
  beds: [],
  bookings: [],
  payments: [],
  transactions: [],
  invoices: [],
  residents: [],
  filteredProperties: [],
  currentPage: 1,
  rowsPerPage: 10,
  statusChart: null,
  addStep: 0,
  geoTimer: null,
  locationSuggestions: [],
  selectedLocation: null,
  pickedImages: [],
  propertyMap: null,
  propertyMarker: null,
  savingProperty: false
};

const defaultAmenities = {
  "Wi-Fi": true,
  "Power Backup": true,
  "RO Water": true,
  "Housekeeping": true,
  "Geyser": true,
  "Air Conditioning": false,
  "Fan": true,
  "Attached Bathroom": false,
  "Common Bathroom": false,
  "Hot Water": true,
  "Drinking Water": true,
  "24/7 Security": true,
  "CCTV Surveillance": true,
  "Fire Extinguisher": true,
  "Secure Entry": true,
  "Guard at Gate": false,
  "Intercom": false,
  "Biometric Entry": false,
  "Laundry": true,
  "Parking": true,
  "Elevator / Lift": false,
  "Common Area": true,
  "Visitor Parking": false,
  "Dining Area": false,
  "Food Facility": true,
  "Refrigerator": false,
  "Microwave": false,
  "Water Cooler": false,
  "Newspaper": false,
  "TV Lounge": false,
  "Gym": false,
  "Study Area": false,
  "Work Desk": false,
  "Balcony": false,
  "Terrace Access": false
};

const defaultRoomAmenities = {
  "Iron Bed": true,
  "Safety Locker": true,
  "Comfortable Peps Mattress": true,
  "Almirah": true,
  "Side Table": true,
  "Chair": true,
  "Study Table": false,
  "Shoe Stand": true,
  "Outside Dustbin": true,
  "Pillow": true,
  "Bedsheet": true,
  "Blanket": true,
  "Plate": true,
  "Bowl": true,
  "Spoon": true,
  "Glass": true,
  "Curtains": false,
  "Mirror": false
};

const defaultHousekeepingAmenities = {
  "Room Cleaning": true,
  "Bathroom Cleaning": true,
  "Common Area Cleaning": true,
  "Room Cleaning 3 Days a Week": true,
  "Washroom Cleaning 3 Days a Week": true,
  "Bedding Change by Housekeeping": true,
  "Garbage Collection": true,
  "Deep Cleaning Monthly": false
};

let amenities = structuredClone(defaultAmenities);
let roomAmenities = structuredClone(defaultRoomAmenities);
let housekeepingAmenities = structuredClone(defaultHousekeepingAmenities);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

function matchesAnyValue(rawValue, rawTargets) {
  const value = normalizeComparable(rawValue);

  if (!value) return false;

  return rawTargets.some((target) => {
    const normalizedTarget = normalizeComparable(target);
    return normalizedTarget && value === normalizedTarget;
  });
}

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function intValue(value) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanLabel(value) {
  const raw = String(value || "").trim();

  if (!raw) return "Unknown";

  return raw
    .replace(/-/g, "_")
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}

function formatMoney(amount) {
  return `₹${safeNumber(amount).toLocaleString("en-IN")}`;
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "Admin").trim();

  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(" ").filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isThisMonth(value) {
  const date = toDate(value);

  if (!date) return false;

  const now = new Date();

  return date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
}

function valueText(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (value !== undefined && value !== null) {
      const clean = String(value).trim();
      if (clean) return clean;
    }
  }

  return "";
}

function lowerText(data, keys) {
  return valueText(data, keys).toLowerCase().trim();
}

function dateValueFromData(data, keys) {
  for (const key of keys) {
    const date = toDate(data?.[key]);
    if (date) return date;
  }

  return null;
}

function isCancelled(status) {
  return ["cancelled", "canceled", "refunded", "rejected"].includes(status);
}

function getPropertyName(property) {
  return property.propertyName || property.name || property.title || property.id || "Unnamed Property";
}

function getPropertyType(property) {
  return property.propertyType || property.type || "PG";
}

function getPropertyCity(property) {
  return property.city || property.propertyCity || "";
}

function getPropertyState(property) {
  return property.state || "";
}

function getPropertyPin(property) {
  return property.pinCode || property.pincode || "";
}

function getPropertyLocation(property) {
  return (
    property.fullAddress ||
    property.location ||
    property.address ||
    property.address1 ||
    property.propertyLocation ||
    "Location not added"
  );
}

function getPropertyImage(property) {
  const directBase64 = property.coverImageBase64 ||
    property.thumbnailBase64 ||
    property.imageBase64 ||
    "";

  if (directBase64) {
    return directBase64.startsWith("data:")
      ? directBase64
      : `data:image/jpeg;base64,${directBase64}`;
  }

  const imageUrl = property.coverImageUrl ||
    property.imageUrl ||
    property.image ||
    property.thumbnail ||
    "";

  if (imageUrl) return imageUrl;

  const images = property.imageUrls || property.images;

  if (Array.isArray(images) && images.length) {
    const first = images[0];

    if (typeof first === "string") return first;

    if (first?.dataUri) return first.dataUri;
    if (first?.imageBase64) return `data:image/jpeg;base64,${first.imageBase64}`;
    if (first?.base64) return `data:image/jpeg;base64,${first.base64}`;
    if (first?.url) return first.url;
  }

  return "";
}

function getPropertyStatus(property) {
  const status = normalize(property.status || property.propertyStatus || "active");

  if (status.includes("maintenance") || status === "under_maintenance") return "under_maintenance";
  if (status.includes("inactive")) return "inactive";
  if (status.includes("available")) return "available";

  return "active";
}

function propertyKeys(property) {
  return [
    property.id,
    property.propertyId,
    property.propertyDocId,
    property.propertyCode,
    property.propertyName,
    property.name,
    property.title
  ].map((value) => String(value || "")).filter(Boolean);
}

function itemPropertyValues(item) {
  return [
    item.propertyId,
    item.property_id,
    item.listingId,
    item.listing_id,
    item.pgId,
    item.pg_id,
    item.propertyName,
    item.property,
    item.listingName,
    item.pgName,
    item.propertyTitle
  ].map((value) => String(value || "")).filter(Boolean);
}

function belongsToProperty(item, property) {
  const targets = propertyKeys(property);

  return itemPropertyValues(item).some((value) => matchesAnyValue(value, targets));
}

function getRelatedRooms(property) {
  return state.rooms.filter((room) => belongsToProperty(room, property));
}

function getRelatedBeds(property) {
  const rooms = getRelatedRooms(property);
  const roomIds = new Set(rooms.map((room) => room.id));

  const roomNos = new Set(
    rooms
      .map((room) => normalizeComparable(
        valueText(room, ["roomNo", "roomNumber", "roomName", "name"])
          .replace(/^Room\s+/i, "")
      ))
      .filter(Boolean)
  );

  return state.beds.filter((bed) => {
    if (belongsToProperty(bed, property)) return true;

    const roomId = valueText(bed, ["roomId", "room_id"]);

    if (roomId && roomIds.has(roomId)) return true;

    const bedRoomNo = normalizeComparable(
      valueText(bed, ["roomNo", "roomNumber", "roomName"])
        .replace(/^Room\s+/i, "")
    );

    return bedRoomNo && roomNos.has(bedRoomNo);
  });
}

function getRoomTotalBeds(room) {
  return safeNumber(room.totalBeds || room.beds || room.bedCount || room.capacity || 0);
}

function getBedStatus(bed) {
  const status = normalize(bed.status || bed.bedStatus || bed.occupancyStatus || "");

  if (status.includes("occupied") || status.includes("booked") || status.includes("checked_in")) return "occupied";
  if (status.includes("maintenance") || status.includes("repair")) return "maintenance";
  if (status.includes("reserved")) return "reserved";

  return "available";
}

function activeBookingBedKeys() {
  const bedIds = new Set();
  const bedNos = new Set();

  state.bookings.forEach((booking) => {
    const status = lowerText(booking, ["status", "bookingStatus"]);

    if (isCancelled(status)) return;

    const bedId = valueText(booking, ["bedId", "bed_id"]);
    const bedNo = normalizeComparable(
      valueText(booking, ["bedNo", "bedNumber", "bedName"])
        .replace(/^Bed\s+/i, "")
    );

    if (bedId) bedIds.add(bedId);
    if (bedNo) bedNos.add(bedNo);
  });

  return { bedIds, bedNos };
}

function getPropertyRooms(property) {
  const relatedRooms = getRelatedRooms(property);

  if (relatedRooms.length) return relatedRooms.length;

  return safeNumber(property.totalRooms || property.rooms || property.roomCount || 0);
}

function getPropertyBeds(property) {
  const relatedBeds = getRelatedBeds(property);

  if (relatedBeds.length) return relatedBeds.length;

  const relatedRooms = getRelatedRooms(property);
  const roomsBeds = relatedRooms.reduce((sum, room) => sum + getRoomTotalBeds(room), 0);

  if (roomsBeds) return roomsBeds;

  return safeNumber(property.totalBeds || property.beds || property.bedCount || 0);
}

function getAvailableRooms(property) {
  const relatedRooms = getRelatedRooms(property);

  if (relatedRooms.length) {
    return relatedRooms.filter((room) => {
      const status = normalize(room.status || room.roomStatus || room.occupancyStatus || "");
      return !status.includes("occupied") && !status.includes("maintenance");
    }).length;
  }

  return safeNumber(property.availableRooms || property.vacantRooms || 0);
}

function getAvailableBeds(property) {
  const relatedBeds = getRelatedBeds(property);
  const { bedIds, bedNos } = activeBookingBedKeys();

  if (relatedBeds.length) {
    return relatedBeds.filter((bed) => {
      const status = getBedStatus(bed);
      const bedNo = normalizeComparable(
        valueText(bed, ["bedNo", "bedNumber", "bedName"]).replace(/^Bed\s+/i, "")
      );

      const booked = bedIds.has(bed.id) || bedNos.has(bedNo);

      return status === "available" && bed.isOccupied !== true && !booked;
    }).length;
  }

  const direct = safeNumber(property.availableBeds || property.vacantBeds || 0);

  if (direct) return direct;

  const totalBeds = getPropertyBeds(property);
  const occupancyRate = safeNumber(property.occupancyRate || property.occupancy || 0);

  if (totalBeds && occupancyRate) {
    return Math.max(0, totalBeds - Math.round((occupancyRate / 100) * totalBeds));
  }

  return 0;
}

function getOccupiedBeds(property) {
  const relatedBeds = getRelatedBeds(property);
  const { bedIds, bedNos } = activeBookingBedKeys();

  return relatedBeds.filter((bed) => {
    const status = getBedStatus(bed);
    const bedNo = normalizeComparable(
      valueText(bed, ["bedNo", "bedNumber", "bedName"]).replace(/^Bed\s+/i, "")
    );

    const booked = bedIds.has(bed.id) || bedNos.has(bedNo);

    return status === "occupied" || bed.isOccupied === true || booked;
  }).length;
}

function getPropertyOccupancy(property) {
  const relatedBeds = getRelatedBeds(property);

  if (relatedBeds.length) {
    const occupied = getOccupiedBeds(property);
    return Math.round((occupied / relatedBeds.length) * 100);
  }

  const explicit = safeNumber(property.occupancyRate || property.occupancy || 0);

  if (explicit) return Math.min(100, explicit);

  const totalBeds = getPropertyBeds(property);
  const availableBeds = getAvailableBeds(property);

  if (!totalBeds) return 0;

  return Math.max(
    0,
    Math.min(100, Math.round(((totalBeds - availableBeds) / totalBeds) * 100))
  );
}

function getPaymentStatus(payment) {
  const status = normalize(payment.status || payment.paymentStatus || payment.invoiceStatus || "");

  if (
    status.includes("paid") ||
    status.includes("success") ||
    status.includes("completed") ||
    status.includes("received")
  ) {
    return "paid";
  }

  return "due";
}

function getPaymentAmount(payment) {
  return safeNumber(
    payment.amount ||
    payment.totalAmount ||
    payment.paymentAmount ||
    payment.invoiceAmount ||
    payment.rent ||
    payment.receivedAmount ||
    payment.amountReceived ||
    0
  );
}

function getPaymentDate(payment) {
  return payment.paymentDate ||
    payment.paidAt ||
    payment.billingDate ||
    payment.invoiceDate ||
    payment.createdAt ||
    "";
}

function getBookingAmount(booking) {
  return safeNumber(
    booking.amount ||
    booking.totalAmount ||
    booking.total_amount ||
    booking.price ||
    booking.bookingAmount ||
    booking.paidAmount ||
    booking.monthlyRent ||
    booking.rentAmount ||
    booking.roomRent ||
    booking.bedRent ||
    0
  );
}

function getPropertyRevenue(property) {
  const allPayments = [
    ...state.payments,
    ...state.transactions,
    ...state.invoices
  ];

  const paidThisMonth = allPayments
    .filter((payment) => belongsToProperty(payment, property))
    .filter((payment) => getPaymentStatus(payment) === "paid")
    .filter((payment) => isThisMonth(getPaymentDate(payment)))
    .reduce((sum, payment) => sum + getPaymentAmount(payment), 0);

  if (paidThisMonth) return paidThisMonth;

  const bookingRevenue = state.bookings
    .filter((booking) => belongsToProperty(booking, property))
    .filter((booking) => !isCancelled(lowerText(booking, ["status", "bookingStatus"])))
    .filter((booking) => isThisMonth(dateValueFromData(
      booking,
      ["createdAt", "created_at", "bookingDate", "checkIn", "check_in"]
    )))
    .reduce((sum, booking) => sum + getBookingAmount(booking), 0);

  if (bookingRevenue) return bookingRevenue;

  return safeNumber(property.monthlyRevenue || property.revenue || property.expectedRevenue || 0);
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

function setupAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "../index.html";
      return;
    }

    const name = user.displayName || "Admin";
    const email = user.email || "admin@email.com";
    const initials = getInitials(name || email);

    $("adminName").textContent = name;
    $("dropdownAdminName").textContent = name;
    $("dropdownAdminEmail").textContent = email;
    $("adminAvatar").textContent = initials;
    $("adminAvatarSmall").textContent = initials;

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

  propertiesDropdown?.classList.add("active");

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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAddPropertyModal();
      $("passwordModal").hidden = true;
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

      applyFilters();
      renderStats();
      renderStatusChart();
    },
    (error) => {
      console.error(`${collectionName} fetch failed:`, error);

      state[stateKey] = [];

      applyFilters();
      renderStats();
      renderStatusChart();
    }
  );
}

function setupFirebase() {
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("rooms", COLLECTIONS.rooms);
  listenCollection("beds", COLLECTIONS.beds);
  listenCollection("bookings", COLLECTIONS.bookings);
  listenCollection("payments", COLLECTIONS.payments);
  listenCollection("transactions", COLLECTIONS.transactions);
  listenCollection("invoices", COLLECTIONS.invoices);
  listenCollection("residents", COLLECTIONS.residents);
}

function renderStats() {
  const totalProperties = state.properties.length;

  const activeProperties = state.properties.filter((property) => {
    const status = getPropertyStatus(property);
    return ["active", "available"].includes(status);
  }).length;

  const totalRooms = state.properties.reduce((sum, property) => sum + getPropertyRooms(property), 0);
  const totalBeds = state.properties.reduce((sum, property) => sum + getPropertyBeds(property), 0);
  const availableRooms = state.properties.reduce((sum, property) => sum + getAvailableRooms(property), 0);
  const availableBeds = state.properties.reduce((sum, property) => sum + getAvailableBeds(property), 0);
  const totalRevenue = state.properties.reduce((sum, property) => sum + getPropertyRevenue(property), 0);
  const occupiedBeds = state.properties.reduce((sum, property) => sum + getOccupiedBeds(property), 0);
  const occupancyRate = totalBeds <= 0 ? 0 : Math.round((occupiedBeds / totalBeds) * 100);

  $("totalProperties").textContent = totalProperties;
  $("activeProperties").textContent = activeProperties;
  $("totalRooms").textContent = totalRooms;
  $("totalBeds").textContent = totalBeds;
  $("availableRooms").textContent = availableRooms;
  $("availableBeds").textContent = availableBeds;
  $("totalOccupancy").textContent = `${occupancyRate}%`;
  $("monthlyRevenue").textContent = formatMoney(totalRevenue);
}

function populateCityFilter() {
  const cityFilter = $("cityFilter");

  if (!cityFilter) return;

  const current = cityFilter.value;

  const cities = [
    ...new Set(state.properties.map((property) => getPropertyCity(property)).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b));

  cityFilter.innerHTML = `<option value="">City: All</option>`;

  cities.forEach((city) => {
    cityFilter.innerHTML += `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`;
  });

  cityFilter.value = cities.includes(current) ? current : "";
}

function applyFilters() {
  populateCityFilter();

  const search = normalize($("tableSearchInput")?.value || $("topSearchInput")?.value);
  const status = $("statusFilter")?.value || "";
  const city = $("cityFilter")?.value || "";
  const type = $("typeFilter")?.value || "";

  state.filteredProperties = state.properties.filter((property) => {
    const name = normalize(getPropertyName(property));
    const location = normalize(getPropertyLocation(property));
    const propertyCity = getPropertyCity(property);
    const propertyState = normalize(getPropertyState(property));
    const pin = normalize(getPropertyPin(property));
    const propertyStatus = getPropertyStatus(property);
    const propertyType = getPropertyType(property);

    const matchesSearch =
      !search ||
      name.includes(search) ||
      location.includes(search) ||
      normalize(propertyCity).includes(search) ||
      propertyState.includes(search) ||
      pin.includes(search) ||
      normalize(propertyType).includes(search) ||
      normalize(propertyStatus).includes(search);

    const matchesStatus = !status || propertyStatus === status;
    const matchesCity = !city || propertyCity === city;
    const matchesType = !type || normalize(propertyType) === normalize(type);

    return matchesSearch && matchesStatus && matchesCity && matchesType;
  });

  renderTable();
}

function renderTable() {
  const tbody = $("propertiesTableBody");
  const summary = $("tableShowingText");

  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(state.filteredProperties.length / state.rowsPerPage));

  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const paginated = state.filteredProperties.slice(start, start + state.rowsPerPage);

  if (!paginated.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-table">
          No properties found. Click “Add Property” to create your first property.
        </td>
      </tr>
    `;

    summary.textContent = "Showing 0 properties";
    renderPagination(totalPages);
    return;
  }

  tbody.innerHTML = paginated.map((property) => {
    const name = getPropertyName(property);
    const propertyId = property.propertyId || property.propertyCode || property.id;
    const type = getPropertyType(property);
    const city = getPropertyCity(property);
    const stateText = getPropertyState(property);
    const pin = getPropertyPin(property);
    const location = getPropertyLocation(property);
    const rooms = getPropertyRooms(property);
    const beds = getPropertyBeds(property);
    const availableRooms = getAvailableRooms(property);
    const availableBeds = getAvailableBeds(property);
    const occupancy = getPropertyOccupancy(property);
    const status = getPropertyStatus(property);
    const revenue = getPropertyRevenue(property);
    const imageUrl = getPropertyImage(property);

    return `
      <tr>
        <td>
          <div class="property-cell">
            ${
              imageUrl
                ? `<img src="${escapeHtml(imageUrl)}" class="property-thumb" alt="${escapeHtml(name)}" />`
                : `<div class="property-placeholder"><i class="fa-solid fa-building"></i></div>`
            }

            <div>
              <h4>${escapeHtml(name)}</h4>
              <p>Property ID: ${escapeHtml(propertyId)}</p>
            </div>
          </div>
        </td>

        <td>
          <strong>${escapeHtml(type)}</strong>
          <div class="table-sub">${escapeHtml(property.propertyCategory || "Co-Living")}</div>
        </td>

        <td>
          <strong>${escapeHtml(location)}</strong>
          <div class="table-sub">${escapeHtml([city, stateText, pin].filter(Boolean).join(" • ") || "City not added")}</div>
        </td>

        <td>
          <strong>${rooms}</strong>
          <div class="table-sub">${availableRooms} Available</div>
        </td>

        <td>
          <strong>${beds}</strong>
          <div class="table-sub">${availableBeds} Available</div>
        </td>

        <td>
          <strong>${occupancy}%</strong>
          <div class="occupancy-bar">
            <span style="width:${occupancy}%"></span>
          </div>
        </td>

        <td>
          <span class="status-pill ${escapeHtml(status)}">${escapeHtml(cleanLabel(status))}</span>
        </td>

        <td>
          <strong>${formatMoney(revenue)}</strong>
        </td>

        <td>
          <div class="actions-cell">
            <button class="view-btn" type="button" title="View" data-id="${escapeHtml(property.id)}">
              <i class="fa-regular fa-eye"></i>
            </button>

            <button class="delete-btn" type="button" data-id="${escapeHtml(property.id)}" title="Delete">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  summary.textContent = `Showing ${start + 1} to ${start + paginated.length} of ${state.filteredProperties.length} properties`;

  tbody.querySelectorAll(".view-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const property = state.properties.find((item) => item.id === button.dataset.id);

      if (!property) return;

      alert(
        `${getPropertyName(property)}\n\n${getPropertyLocation(property)}\n\nRooms: ${getPropertyRooms(property)}\nBeds: ${getPropertyBeds(property)}\nOccupancy: ${getPropertyOccupancy(property)}%`
      );
    });
  });

  tbody.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const property = state.properties.find((item) => item.id === button.dataset.id);

      if (!property) return;

      await confirmDeleteProperty(property);
    });
  });

  renderPagination(totalPages);
}

async function confirmDeleteProperty(property) {
  const name = getPropertyName(property);
  const relatedRooms = getRelatedRooms(property);
  const relatedBeds = getRelatedBeds(property);

  if (!confirm(`Delete "${name}"?\n\nThis will delete linked rooms and beds. Bookings will not be deleted.`)) return;

  try {
    const batch = writeBatch(db);

    relatedBeds.forEach((bed) => {
      batch.delete(doc(db, COLLECTIONS.beds, bed.id));
    });

    relatedRooms.forEach((room) => {
      batch.delete(doc(db, COLLECTIONS.rooms, room.id));
    });

    batch.delete(doc(db, COLLECTIONS.properties, property.id));

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "Property deleted",
      message: `${name} was deleted with ${relatedRooms.length} rooms and ${relatedBeds.length} beds.`,
      type: "property",
      module: "Properties",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    toast(`Deleted ${name} with ${relatedRooms.length} rooms and ${relatedBeds.length} beds.`);
  } catch (error) {
    console.error("Property delete failed:", error);
    toast("Property delete failed. Check Firebase permission rules.", true);
  }
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
    renderTable();
  });

  container.appendChild(prev);

  const maxButtons = Math.min(totalPages, 7);

  for (let page = 1; page <= maxButtons; page++) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = page;
    button.className = page === state.currentPage ? "active" : "";

    button.addEventListener("click", () => {
      state.currentPage = page;
      renderTable();
    });

    container.appendChild(button);
  }

  const next = document.createElement("button");

  next.type = "button";
  next.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
  next.disabled = state.currentPage === totalPages;
  next.addEventListener("click", () => {
    state.currentPage += 1;
    renderTable();
  });

  container.appendChild(next);
}

function renderStatusChart() {
  const active = state.properties.filter((property) => {
    return ["active", "available"].includes(getPropertyStatus(property));
  }).length;

  const inactive = state.properties.filter((property) => {
    return getPropertyStatus(property) === "inactive";
  }).length;

  const maintenance = state.properties.filter((property) => {
    return getPropertyStatus(property) === "under_maintenance";
  }).length;

  const total = state.properties.length || 1;
  const canvas = $("propertyStatusChart");

  if (!canvas || !window.Chart) return;

  if (state.statusChart) {
    state.statusChart.destroy();
  }

  state.statusChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Active", "Inactive", "Under Maintenance"],
      datasets: [
        {
          data: [active, inactive, maintenance],
          backgroundColor: ["#2b944c", "#d09112", "#9c1d2b"],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });

  $("statusLegend").innerHTML = `
    <div class="status-legend-row">
      <span><span class="legend-dot" style="background:#2b944c"></span>Active</span>
      <strong>${active} (${Math.round((active / total) * 100)}%)</strong>
    </div>

    <div class="status-legend-row">
      <span><span class="legend-dot" style="background:#d09112"></span>Inactive</span>
      <strong>${inactive} (${Math.round((inactive / total) * 100)}%)</strong>
    </div>

    <div class="status-legend-row">
      <span><span class="legend-dot" style="background:#9c1d2b"></span>Under Maintenance</span>
      <strong>${maintenance} (${Math.round((maintenance / total) * 100)}%)</strong>
    </div>
  `;
}

function exportPropertiesCsv() {
  const rows = [
    [
      "Property Name",
      "Type",
      "City",
      "State",
      "PIN",
      "Location",
      "Rooms",
      "Beds",
      "Available Rooms",
      "Available Beds",
      "Occupancy",
      "Status",
      "Revenue"
    ],
    ...state.filteredProperties.map((property) => [
      getPropertyName(property),
      getPropertyType(property),
      getPropertyCity(property),
      getPropertyState(property),
      getPropertyPin(property),
      getPropertyLocation(property),
      getPropertyRooms(property),
      getPropertyBeds(property),
      getAvailableRooms(property),
      getAvailableBeds(property),
      `${getPropertyOccupancy(property)}%`,
      getPropertyStatus(property),
      getPropertyRevenue(property)
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
  link.download = "properties.csv";
  link.click();

  URL.revokeObjectURL(url);
}

function renderAmenityGroups() {
  const container = $("amenityGroups");

  if (!container) return;

  const groups = [
    {
      title: "Essentials",
      source: amenities,
      keys: ["Wi-Fi", "Power Backup", "RO Water", "Housekeeping", "Geyser", "Air Conditioning", "Fan", "Hot Water", "Drinking Water"]
    },
    {
      title: "Safety & Security",
      source: amenities,
      keys: ["24/7 Security", "CCTV Surveillance", "Fire Extinguisher", "Secure Entry", "Guard at Gate", "Intercom", "Biometric Entry"]
    },
    {
      title: "Convenience",
      source: amenities,
      keys: ["Laundry", "Parking", "Elevator / Lift", "Common Area", "Visitor Parking", "Dining Area", "Food Facility", "Refrigerator", "Microwave", "Water Cooler"]
    },
    {
      title: "Lifestyle",
      source: amenities,
      keys: ["TV Lounge", "Gym", "Study Area", "Work Desk", "Balcony", "Terrace Access", "Newspaper"]
    },
    {
      title: "Room Amenities",
      source: roomAmenities,
      keys: Object.keys(roomAmenities)
    },
    {
      title: "Housekeeping",
      source: housekeepingAmenities,
      keys: Object.keys(housekeepingAmenities)
    }
  ];

  container.innerHTML = groups.map((group, groupIndex) => {
    const selectedCount = group.keys.filter((key) => group.source[key]).length;

    return `
      <article class="amenity-group" data-group-index="${groupIndex}">
        <div class="amenity-group-head">
          <h4>${escapeHtml(group.title)} <small>${selectedCount}/${group.keys.length}</small></h4>

          <div class="amenity-group-actions">
            <button type="button" data-action="select" data-group-index="${groupIndex}">Select All</button>
            <button type="button" data-action="clear" data-group-index="${groupIndex}">Clear</button>
          </div>
        </div>

        <div class="amenity-check-grid">
          ${group.keys.map((key) => `
            <label class="amenity-check">
              <input
                type="checkbox"
                data-group-index="${groupIndex}"
                data-key="${escapeHtml(key)}"
                ${group.source[key] ? "checked" : ""}
              />
              <span>${escapeHtml(key)}</span>
            </label>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const group = groups[Number(checkbox.dataset.groupIndex)];
      group.source[checkbox.dataset.key] = checkbox.checked;
      renderAmenityGroups();
    });
  });

  container.querySelectorAll(".amenity-group-actions button").forEach((button) => {
    button.addEventListener("click", () => {
      const group = groups[Number(button.dataset.groupIndex)];
      const value = button.dataset.action === "select";

      group.keys.forEach((key) => {
        group.source[key] = value;
      });

      renderAmenityGroups();
    });
  });
}

function openAddPropertyModal() {
  resetAddPropertyForm();

  $("addPropertyModal").hidden = false;
  document.body.style.overflow = "hidden";

  renderAmenityGroups();
  updateWizardUi();

  setTimeout(() => {
    initMap();
  }, 200);
}

function closeAddPropertyModal() {
  const modal = $("addPropertyModal");

  if (!modal || modal.hidden || state.savingProperty) return;

  modal.hidden = true;
  document.body.style.overflow = "";
}

function resetAddPropertyForm() {
  state.addStep = 0;
  state.locationSuggestions = [];
  state.selectedLocation = null;
  state.pickedImages = [];
  state.savingProperty = false;

  amenities = structuredClone(defaultAmenities);
  roomAmenities = structuredClone(defaultRoomAmenities);
  housekeepingAmenities = structuredClone(defaultHousekeepingAmenities);

  $("addPropertyForm")?.reset();

  $("propertyTypeInput").value = "PG";
  $("propertyStatusInput").value = "active";
  $("countryInput").value = "India";
  $("geoSuggestions").hidden = true;
  $("geoSuggestions").innerHTML = "";
  $("geoLoading").hidden = true;
  $("imagePreviewGrid").innerHTML = `<div class="empty-upload">No images selected</div>`;
  $("mapNote").textContent = "Start typing and select a Geoapify location from the dropdown. You can also tap the map to adjust the marker.";

  if (state.propertyMarker && state.propertyMap) {
    state.propertyMap.removeLayer(state.propertyMarker);
    state.propertyMarker = null;
  }
}

function updateWizardUi() {
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.stepPanel) === state.addStep);
  });

  document.querySelectorAll("#addStepHeader button").forEach((button) => {
    const step = Number(button.dataset.step);

    button.classList.toggle("active", step === state.addStep);
    button.classList.toggle("done", step < state.addStep);
  });

  $("wizardBackBtn").disabled = state.savingProperty;
  $("wizardNextBtn").disabled = state.savingProperty;

  $("wizardNextBtn").innerHTML = state.savingProperty
    ? `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`
    : state.addStep === 4
      ? `Save <i class="fa-solid fa-check"></i>`
      : `Next <i class="fa-solid fa-arrow-right"></i>`;

  if (state.addStep === 4) renderReview();

  if (state.addStep === 2) {
    setTimeout(() => {
      initMap();
      state.propertyMap?.invalidateSize();
    }, 120);
  }
}

function stepValidation(step) {
  if (step === 0) {
    const fields = [
      ["propertyNameInput", "Property name is required."],
      ["propertyTypeInput", "Property type is required."],
      ["noticePeriodInput", "Notice period is required."],
      ["advanceRentInput", "Advance rent is required."],
      ["securityDepositInput", "Security deposit is required."],
      ["descriptionInput", "Description is required."]
    ];

    for (const [id, message] of fields) {
      if (!$(id)?.value.trim()) {
        toast(message, true);
        $(id)?.focus();
        return false;
      }
    }
  }

  if (step === 2) {
    const fields = [
      ["addressInput", "Full address is required."],
      ["cityInput", "City is required."],
      ["stateInput", "State is required."],
      ["pinCodeInput", "PIN code is required."],
      ["countryInput", "Country is required."]
    ];

    for (const [id, message] of fields) {
      if (!$(id)?.value.trim()) {
        toast(message, true);
        $(id)?.focus();
        return false;
      }
    }

    if (!state.selectedLocation) {
      toast("Please select the exact location from Geoapify dropdown or map.", true);
      return false;
    }
  }

  return true;
}

function goNextStep() {
  if (state.savingProperty) return;

  if (!stepValidation(state.addStep)) return;

  if (state.addStep === 4) {
    saveProperty();
    return;
  }

  state.addStep += 1;
  updateWizardUi();
}

function goBackStep() {
  if (state.savingProperty) return;

  if (state.addStep === 0) {
    closeAddPropertyModal();
    return;
  }

  state.addStep -= 1;
  updateWizardUi();
}

async function searchLocation(query) {
  clearTimeout(state.geoTimer);

  const keyword = query.trim();

  if (keyword.length < 2) {
    state.locationSuggestions = [];
    $("geoSuggestions").hidden = true;
    $("geoSuggestions").innerHTML = "";
    $("geoLoading").hidden = true;
    return;
  }

  $("geoLoading").hidden = false;

  state.geoTimer = setTimeout(async () => {
    try {
      const suggestions = await fetchGeoapifyLocations(keyword);
      state.locationSuggestions = suggestions;
      renderGeoSuggestions();
    } catch (error) {
      console.error("Location search failed:", error);

      state.locationSuggestions = [];
      $("geoSuggestions").hidden = false;
      $("geoSuggestions").innerHTML = `
        <div class="geo-item">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <div>
            <strong>Location search failed</strong>
            <span>Check Geoapify API key and internet connection.</span>
          </div>
        </div>
      `;
    } finally {
      $("geoLoading").hidden = true;
    }
  }, 320);
}

async function fetchGeoapifyLocations(keyword) {
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");

  url.searchParams.set("text", keyword.trim());
  url.searchParams.set("apiKey", GEOAPIFY_API_KEY.trim());
  url.searchParams.set("filter", "countrycode:in");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", "20");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Geoapify returned ${response.status}`);
  }

  const decoded = await response.json();
  const features = Array.isArray(decoded.features) ? decoded.features : [];
  const seen = new Set();
  const suggestions = [];

  features.forEach((feature) => {
    const suggestion = geoapifySuggestionFromFeature(feature);

    if (!suggestion) return;

    const key = `${suggestion.latitude.toFixed(6)},${suggestion.longitude.toFixed(6)}`;

    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push(suggestion);
    }
  });

  const query = keyword.toLowerCase();

  suggestions.sort((a, b) => {
    const aStarts = a.searchText.startsWith(query);
    const bStarts = b.searchText.startsWith(query);

    if (aStarts !== bStarts) return aStarts ? -1 : 1;

    const aContains = a.searchText.includes(query);
    const bContains = b.searchText.includes(query);

    if (aContains !== bContains) return aContains ? -1 : 1;

    return a.displayName.length - b.displayName.length;
  });

  return suggestions;
}

function firstNonEmpty(values) {
  for (const value of values) {
    const clean = String(value || "").trim();

    if (clean) return clean;
  }

  return "";
}

function geoapifySuggestionFromFeature(feature) {
  const properties = feature?.properties;

  if (!properties) return null;

  const coordinates = feature?.geometry?.coordinates || [];

  let latitude = safeNumber(properties.lat);
  let longitude = safeNumber(properties.lon);

  if ((!latitude || !longitude) && Array.isArray(coordinates) && coordinates.length >= 2) {
    longitude = safeNumber(coordinates[0]);
    latitude = safeNumber(coordinates[1]);
  }

  const formatted = firstNonEmpty([
    properties.formatted,
    properties.address_line1,
    properties.address_line2
  ]);

  if (!formatted || !latitude || !longitude) return null;

  const placeName = firstNonEmpty([
    properties.name,
    properties.address_line1,
    properties.street,
    properties.suburb,
    properties.district,
    properties.city,
    formatted.split(",")[0]
  ]);

  const city = firstNonEmpty([
    properties.city,
    properties.town,
    properties.village,
    properties.suburb,
    properties.county,
    properties.district
  ]);

  const suggestion = {
    placeName,
    displayName: formatted,
    latitude,
    longitude,
    city,
    state: String(properties.state || ""),
    pinCode: String(properties.postcode || ""),
    country: String(properties.country || "India")
  };

  suggestion.searchText =
    `${suggestion.placeName} ${suggestion.displayName} ${suggestion.city} ${suggestion.state} ${suggestion.pinCode}`
      .toLowerCase()
      .trim();

  return suggestion;
}

function renderGeoSuggestions() {
  const box = $("geoSuggestions");

  if (!box) return;

  box.hidden = false;

  if (!state.locationSuggestions.length) {
    box.innerHTML = `
      <div class="geo-item">
        <i class="fa-solid fa-magnifying-glass"></i>
        <div>
          <strong>No matching location found</strong>
          <span>Try typing nearby area, city, landmark or PIN code.</span>
        </div>
      </div>
    `;
    return;
  }

  box.innerHTML = state.locationSuggestions.map((suggestion, index) => `
    <button type="button" class="geo-item" data-index="${index}">
      <i class="fa-solid fa-location-dot"></i>

      <div>
        <strong>${escapeHtml(suggestion.placeName || suggestion.displayName)}</strong>
        <span>${escapeHtml(suggestion.displayName)}</span>
      </div>
    </button>
  `).join("");

  box.querySelectorAll(".geo-item[data-index]").forEach((button) => {
    button.addEventListener("click", () => {
      selectLocation(state.locationSuggestions[Number(button.dataset.index)]);
    });
  });
}

function selectLocation(suggestion) {
  if (!suggestion) return;

  $("placeSearchInput").value = suggestion.placeName || suggestion.displayName;
  $("addressInput").value = suggestion.displayName;
  $("cityInput").value = suggestion.city;
  $("stateInput").value = suggestion.state;
  $("pinCodeInput").value = suggestion.pinCode;
  $("countryInput").value = suggestion.country || "India";

  state.selectedLocation = {
    latitude: suggestion.latitude,
    longitude: suggestion.longitude
  };

  $("geoSuggestions").hidden = true;
  $("geoSuggestions").innerHTML = "";

  updateMapMarker();
}

function initMap() {
  const mapBox = $("propertyMap");

  if (!mapBox || !window.L) return;

  if (!state.propertyMap) {
    state.propertyMap = L.map(mapBox).setView([20.5937, 78.9629], 4.5);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(state.propertyMap);

    state.propertyMap.on("click", (event) => {
      state.selectedLocation = {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng
      };

      updateMapMarker();
    });
  }

  setTimeout(() => {
    state.propertyMap.invalidateSize();
  }, 80);

  updateMapMarker();
}

function updateMapMarker() {
  if (!state.propertyMap || !state.selectedLocation) return;

  const latLng = [
    state.selectedLocation.latitude,
    state.selectedLocation.longitude
  ];

  if (state.propertyMarker) {
    state.propertyMarker.setLatLng(latLng);
  } else {
    state.propertyMarker = L.marker(latLng).addTo(state.propertyMap);
  }

  state.propertyMap.setView(latLng, 15);

  $("mapNote").textContent =
    `Exact location selected: ${state.selectedLocation.latitude.toFixed(6)}, ${state.selectedLocation.longitude.toFixed(6)}`;
}

function renderPreviewImages() {
  const grid = $("imagePreviewGrid");

  if (!grid) return;

  if (!state.pickedImages.length) {
    grid.innerHTML = `<div class="empty-upload">No images selected</div>`;
    return;
  }

  grid.innerHTML = state.pickedImages.map((image, index) => `
    <div class="preview-image">
      <img src="${escapeHtml(image.dataUri)}" alt="Property image ${index + 1}" />
      <button type="button" data-remove-image="${index}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");

  grid.querySelectorAll("[data-remove-image]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pickedImages.splice(Number(button.dataset.removeImage), 1);
      renderPreviewImages();
    });
  });
}

function imageFileToCompressedBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read image."));

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => reject(new Error("Invalid image file."));

      image.onload = () => {
        const maxWidth = 900;
        const scale = image.width > maxWidth ? maxWidth / image.width : 1;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const dataUri = canvas.toDataURL("image/jpeg", 0.42);
        const base64 = dataUri.split(",")[1] || "";

        resolve({
          fileName: safeFileName(file.name || "property-image.jpg"),
          mimeType: "image/jpeg",
          dataUri,
          base64
        });
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

async function handleImagesPicked(files) {
  const selected = Array.from(files || []).slice(0, 15 - state.pickedImages.length);

  for (const file of selected) {
    try {
      const imagePayload = await imageFileToCompressedBase64(file);

      if (imagePayload.base64.length > 900000) {
        toast(`${file.name} is still too large after compression. Use a smaller image.`, true);
        continue;
      }

      state.pickedImages.push(imagePayload);
    } catch (error) {
      toast(error.message || "Image processing failed.", true);
    }
  }

  renderPreviewImages();
}

function safeFileName(name) {
  return String(name || "property-image.jpg")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

function renderReview() {
  const selectedAmenities = Object.entries(amenities)
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  const selectedRoomAmenities = Object.entries(roomAmenities)
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  const selectedHousekeeping = Object.entries(housekeepingAmenities)
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  const rows = [
    ["Property Name", $("propertyNameInput").value],
    ["Type", $("propertyTypeInput").value],
    ["Status", $("propertyStatusInput").value],
    ["Notice Period", `${$("noticePeriodInput").value || 0} days`],
    ["Advance Rent", formatMoney($("advanceRentInput").value)],
    ["Security Deposit", `${$("securityDepositInput").value || 0} months`],
    ["Description", $("descriptionInput").value],
    ["Place Name", $("placeSearchInput").value],
    ["Full Address", $("addressInput").value],
    ["Landmark", $("landmarkInput").value],
    ["City", $("cityInput").value],
    ["State", $("stateInput").value],
    ["PIN Code", $("pinCodeInput").value],
    ["Country", $("countryInput").value],
    ["Amenities", `${selectedAmenities.length} selected`],
    ["Room Amenities", `${selectedRoomAmenities.length} selected`],
    ["Housekeeping", `${selectedHousekeeping.length} selected`],
    ["Images", `${state.pickedImages.length} selected`],
    [
      "Location",
      state.selectedLocation
        ? `${state.selectedLocation.latitude.toFixed(6)}, ${state.selectedLocation.longitude.toFixed(6)}`
        : "Not selected"
    ]
  ];

  $("reviewList").innerHTML = rows.map(([label, value]) => `
    <div class="review-row">
      <b>${escapeHtml(label)}</b>
      <span>${escapeHtml(value || "Not added")}</span>
    </div>
  `).join("");
}

function buildKeywords(...parts) {
  const words = new Set();

  parts.forEach((part) => {
    String(part || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .forEach((word) => {
        words.add(word);

        for (let i = 1; i <= word.length; i++) {
          words.add(word.slice(0, i));
        }
      });
  });

  return [...words].slice(0, 300);
}

function validatePropertyBeforeSave() {
  const required = [
    ["propertyNameInput", "Property name is required."],
    ["propertyTypeInput", "Property type is required."],
    ["addressInput", "Full address is required."],
    ["cityInput", "City is required."],
    ["stateInput", "State is required."],
    ["pinCodeInput", "PIN code is required."]
  ];

  for (const [id, message] of required) {
    if (!$(id).value.trim()) {
      toast(message, true);
      return false;
    }
  }

  if (!state.selectedLocation) {
    toast("Exact map location is required.", true);
    return false;
  }

  return true;
}

async function saveProperty() {
  if (state.savingProperty) return;

  if (!validatePropertyBeforeSave()) return;

  state.savingProperty = true;
  updateWizardUi();

  try {
    const propertyRef = doc(collection(db, COLLECTIONS.properties));
    const imageDocIds = [];
    const imageDocuments = [];

    let coverImageBase64 = "";

    for (let i = 0; i < state.pickedImages.length; i++) {
      const image = state.pickedImages[i];
      const imageDocRef = doc(collection(db, COLLECTIONS.propertyImages));
      const imageDocId = imageDocRef.id;

      if (i === 0) {
        coverImageBase64 = image.base64;
      }

      imageDocIds.push(imageDocId);

      imageDocuments.push({
        id: imageDocId,
        fileName: image.fileName,
        mimeType: "image/jpeg",
        order: i,
        isPrimary: i === 0,
        collection: COLLECTIONS.propertyImages
      });

      await setDoc(imageDocRef, {
        propertyImageId: imageDocId,
        propertyId: propertyRef.id,
        propertyName: $("propertyNameInput").value.trim(),
        fileName: image.fileName,
        mimeType: "image/jpeg",
        order: i,
        isPrimary: i === 0,
        imageBase64: image.base64,
        base64: image.base64,
        dataUri: image.dataUri,
        source: "admin_all_properties_web",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    const amenitiesSelected = Object.entries(amenities)
      .filter((entry) => entry[1])
      .map((entry) => entry[0]);

    const roomAmenitiesSelected = Object.entries(roomAmenities)
      .filter((entry) => entry[1])
      .map((entry) => entry[0]);

    const housekeepingSelected = Object.entries(housekeepingAmenities)
      .filter((entry) => entry[1])
      .map((entry) => entry[0]);

    const roomAmenitiesDescription =
      "Iron bed with safety locker to store valuables, comfortable Peps mattress, almirah, side table, chair, shoe stand, outside dustbin, pillows, bedsheets, blankets, plate, bowl, spoon and glass are provided.";

    const housekeepingDescription =
      "Housekeeping includes room, bathroom and common area cleaning. Room and washroom cleaning is done 3 days a week. Bedding will be handled by housekeeping.";

    const name = $("propertyNameInput").value.trim();
    const type = $("propertyTypeInput").value.trim();
    const address = $("addressInput").value.trim();
    const city = $("cityInput").value.trim();
    const stateName = $("stateInput").value.trim();
    const pinCode = $("pinCodeInput").value.trim();

    await setDoc(propertyRef, {
      propertyId: propertyRef.id,
      propertyName: name,
      name,
      title: name,
      propertyType: type,
      type,
      status: $("propertyStatusInput").value,
      propertyStatus: $("propertyStatusInput").value,
      description: $("descriptionInput").value.trim(),
      noticePeriodDays: intValue($("noticePeriodInput").value),
      advanceRoomRent: intValue($("advanceRentInput").value),
      securityDepositMonths: intValue($("securityDepositInput").value),
      placeName: $("placeSearchInput").value.trim(),
      address,
      fullAddress: address,
      location: address,
      landmark: $("landmarkInput").value.trim(),
      city,
      state: stateName,
      country: "India",
      pinCode,
      pincode: pinCode,
      latitude: state.selectedLocation.latitude,
      longitude: state.selectedLocation.longitude,
      geoPoint: new GeoPoint(
        state.selectedLocation.latitude,
        state.selectedLocation.longitude
      ),
      mapProvider: "OpenStreetMap",
      amenities,
      amenitiesList: amenitiesSelected,
      roomAmenities,
      roomAmenitiesList: roomAmenitiesSelected,
      roomAmenitiesDescription,
      housekeepingAmenities,
      housekeepingList: housekeepingSelected,
      housekeepingDescription,
      imageStorageType: "firestore_base64",
      imageCount: imageDocIds.length,
      imageDocIds,
      imageRefs: imageDocIds,
      imageDocuments,
      coverImageDocId: imageDocIds.length ? imageDocIds[0] : "",
      coverImageBase64,
      thumbnailBase64: coverImageBase64,
      imageBase64: coverImageBase64,
      imageUrls: [],
      images: imageDocuments,
      imageUrl: "",
      searchKeywords: buildKeywords(name, type, address, city, stateName, pinCode),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await setDoc(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "New property added",
      message: `${name} was added.`,
      type: "property",
      module: "Properties",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    toast("Property saved successfully.");
    closeAddPropertyModal();
  } catch (error) {
    console.error("Save property failed:", error);
    toast(error.message || "Failed to save property.", true);
  } finally {
    state.savingProperty = false;
    updateWizardUi();
  }
}

function setupEvents() {
  $("topSearchInput")?.addEventListener("input", () => {
    $("tableSearchInput").value = $("topSearchInput").value;
    state.currentPage = 1;
    applyFilters();
  });

  $("tableSearchInput")?.addEventListener("input", () => {
    $("topSearchInput").value = $("tableSearchInput").value;
    state.currentPage = 1;
    applyFilters();
  });

  ["statusFilter", "cityFilter", "typeFilter"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      state.currentPage = 1;
      applyFilters();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("topSearchInput").value = "";
    $("tableSearchInput").value = "";
    $("statusFilter").value = "";
    $("cityFilter").value = "";
    $("typeFilter").value = "";

    state.currentPage = 1;
    applyFilters();
  });

  $("exportBtn")?.addEventListener("click", exportPropertiesCsv);

  $("openAddPropertyBtn")?.addEventListener("click", openAddPropertyModal);
  $("sideAddPropertyBtn")?.addEventListener("click", openAddPropertyModal);

  $("closeAddPropertyBtn")?.addEventListener("click", closeAddPropertyModal);

  $("helpAddPropertyBtn")?.addEventListener("click", () => {
    toast("Fill details, select amenities, choose exact map location, upload images, then save.");
  });

  $("wizardNextBtn")?.addEventListener("click", goNextStep);
  $("wizardBackBtn")?.addEventListener("click", goBackStep);

  document.querySelectorAll("#addStepHeader button").forEach((button) => {
    button.addEventListener("click", () => {
      const targetStep = Number(button.dataset.step);

      if (targetStep <= state.addStep) {
        state.addStep = targetStep;
        updateWizardUi();
      }
    });
  });

  $("placeSearchInput")?.addEventListener("input", (event) => {
    searchLocation(event.target.value);
  });

  $("propertyImagesInput")?.addEventListener("change", async (event) => {
    await handleImagesPicked(event.target.files);
    event.target.value = "";
  });

  $("breadcrumbPropertiesBtn")?.addEventListener("click", () => {
    $("propertiesDropdown")?.classList.toggle("active");
  });

  $("bulkUploadBtn")?.addEventListener("click", () => {
    toast("Bulk upload can be connected to an Excel/CSV importer later.");
  });

  $("importExcelBtn")?.addEventListener("click", () => {
    toast("Excel import can be connected to a file parser later.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});