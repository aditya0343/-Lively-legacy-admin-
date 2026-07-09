import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  addDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  properties: "properties",
  rooms: "rooms",
  beds: "beds",
  bookings: "bookings",
  activityLogs: "activity_logs"
};

const COLORS = {
  gold: "#B68B2D",
  navy: "#061B32",
  green: "#2E8A4E",
  burgundy: "#7A1024",
  purple: "#6352C7",
  orange: "#E18A00",
  gray: "#667085",
  blue: "#3B82F6",
  soft: "#edf0f5"
};

const state = {
  properties: [],
  rooms: [],
  beds: [],
  bookings: [],
  filteredRooms: [],
  currentPage: 1,
  rowsPerPage: 8,
  charts: {},
  saving: false
};

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^room\s+/i, "")
    .replace(/^bed\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function intValue(value) {
  return Math.round(safeNumber(value));
}

function money(value) {
  const number = safeNumber(value);

  if (number >= 10000000) return `₹${(number / 10000000).toFixed(1)}Cr`;
  if (number >= 100000) return `₹${(number / 100000).toFixed(1)}L`;
  if (number >= 1000) return `₹${(number / 1000).toFixed(1)}K`;

  return `₹${Math.round(number).toLocaleString("en-IN")}`;
}

function fullMoney(value) {
  return `₹${safeNumber(value).toLocaleString("en-IN", {
    maximumFractionDigits: 0
  })}`;
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

  const upper = raw.toUpperCase();
  if (upper === "AC" || upper === "PG") return upper;

  return raw
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .map((part) => {
      if (!part) return part;
      const partUpper = part.toUpperCase();
      if (partUpper === "AC" || partUpper === "PG") return partUpper;
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
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

function textValue(data, keys) {
  return valueText(data, keys).toLowerCase().trim();
}

function numberFromData(data, keys) {
  for (const key of keys) {
    const number = safeNumber(data?.[key]);
    if (number) return number;
  }

  return 0;
}

function dateFromData(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (!value) continue;
    if (value.toDate && typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "Admin").trim();
  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function matchesAnyValue(rawValue, targets) {
  const value = normalizeComparable(rawValue);
  if (!value) return false;

  return targets.some((target) => {
    const normalizedTarget = normalizeComparable(target);
    return normalizedTarget && value === normalizedTarget;
  });
}

function propertyDisplayName(data, fallbackId) {
  return valueText(data, ["propertyName", "name", "title", "property_name"]) || fallbackId || "";
}

function roomDisplayName(data, fallbackId) {
  const value = valueText(data, ["roomNo", "roomNumber", "roomName", "name"]);
  return value ? value.replace(/^Room\s+/i, "") : fallbackId || "";
}

function roomCooling(data) {
  return cleanLabel(valueText(data, ["coolingType", "roomCooling", "cooling"]) || "Unknown");
}

function roomType(data) {
  return cleanLabel(valueText(data, ["roomType", "sharingType", "type"]) || "Unknown");
}

function capacityForRoomType(type) {
  const value = normalize(type);

  if (value.includes("triple")) return 3;
  if (value.includes("double")) return 2;

  return 1;
}

function statusNormalize(value) {
  const status = normalize(value).replaceAll(" ", "_");

  if (["occupied", "booked", "checked_in", "checked-in", "checkedin"].includes(status)) {
    return "occupied";
  }

  if (["maintenance", "under_maintenance", "repair"].includes(status)) {
    return "maintenance";
  }

  if (["inactive", "disabled", "closed"].includes(status)) {
    return "inactive";
  }

  return "available";
}

function isAvailable(status) {
  return ["available", "vacant", "open", "active"].includes(normalize(status));
}

function isOccupied(status) {
  return ["occupied", "booked", "checked_in", "checked-in", "checked in"].includes(normalize(status));
}

function isMaintenance(status) {
  return ["maintenance", "under maintenance", "under_maintenance"].includes(normalize(status));
}

function isInactive(status) {
  return ["inactive", "disabled", "closed"].includes(normalize(status));
}

function isCancelled(status) {
  return ["cancelled", "canceled", "refunded", "rejected"].includes(normalize(status));
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
  ].includes(normalize(status));
}

function roomStatusColor(status) {
  const value = normalize(status);

  if (isAvailable(value)) return COLORS.green;
  if (isOccupied(value)) return COLORS.burgundy;
  if (isMaintenance(value)) return COLORS.orange;
  if (isInactive(value)) return COLORS.gray;

  return COLORS.gold;
}

function propertyValues(item) {
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

function roomValues(item) {
  return [
    item.roomId,
    item.room_id,
    item.roomNo,
    item.roomNumber,
    item.roomName,
    item.name
  ].map((value) => String(value || "")).filter(Boolean);
}

function bedValues(item) {
  return [
    item.bedId,
    item.bed_id,
    item.bedNo,
    item.bedNumber,
    item.bedName,
    item.name
  ].map((value) => String(value || "")).filter(Boolean);
}

function belongsToProperty(data, propertyId, propertyName) {
  return propertyValues(data).some((value) => {
    return matchesAnyValue(value, [propertyId, propertyName]);
  });
}

function belongsToRoom(data, roomId, roomNo, propertyId, propertyName) {
  const roomIdValue = valueText(data, ["roomId", "room_id"]);

  if (matchesAnyValue(roomIdValue, [roomId])) {
    return true;
  }

  const roomNoMatch = roomValues(data).some((value) => {
    return matchesAnyValue(value, [roomNo, `Room ${roomNo}`]);
  });

  if (!roomNoMatch) return false;

  const hasPropertyField = propertyValues(data).length > 0;
  if (!hasPropertyField) return true;

  return belongsToProperty(data, propertyId, propertyName);
}

function findPropertyForRoom(room) {
  const propertyId = valueText(room, ["propertyId", "property_id", "listingId", "listing_id", "pgId", "pg_id"]);
  const propertyName = valueText(room, ["propertyName", "property", "listingName", "pgName"]);

  return state.properties.find((property) => {
    const display = propertyDisplayName(property, property.id);
    return matchesAnyValue(propertyId, [property.id, display]) ||
      matchesAnyValue(propertyName, [property.id, display]);
  });
}

function bookingAmount(booking) {
  return numberFromData(booking, [
    "amount",
    "totalAmount",
    "total_amount",
    "price",
    "bookingAmount",
    "paidAmount",
    "monthlyRent",
    "roomRent",
    "rentAmount",
    "bedRent",
    "foodAmount",
    "rentInvoiceAmount"
  ]);
}

function buildRoomRecords() {
  const activeRoomIds = new Set();
  const activeRoomNos = new Set();
  const activeBedIds = new Set();
  const activeBedNos = new Set();

  state.bookings.forEach((booking) => {
    const status = textValue(booking, ["status", "bookingStatus"]);
    if (!isActiveBooking(status) || isCancelled(status)) return;

    const roomId = valueText(booking, ["roomId", "room_id"]);
    const roomNo = valueText(booking, ["roomNo", "roomNumber", "roomName"]);
    const bedId = valueText(booking, ["bedId", "bed_id"]);
    const bedNo = valueText(booking, ["bedNo", "bedNumber", "bedName"]);

    if (roomId) activeRoomIds.add(roomId);
    if (roomNo) activeRoomNos.add(normalizeComparable(roomNo));
    if (bedId) activeBedIds.add(bedId);
    if (bedNo) activeBedNos.add(normalizeComparable(bedNo));
  });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return state.rooms.map((room) => {
    const property = findPropertyForRoom(room);

    const propertyId =
      valueText(room, ["propertyId", "property_id", "listingId", "listing_id", "pgId", "pg_id"]) ||
      property?.id ||
      "";

    const propertyName =
      valueText(room, ["propertyName", "property", "listingName", "pgName"]) ||
      (property ? propertyDisplayName(property, property.id) : "");

    const finalRoomNo = roomDisplayName(room, room.id);
    const finalCooling = roomCooling(room);
    const finalType = roomType(room);

    const capacityRaw = intValue(
      room.sharingCapacity ||
      room.capacity ||
      room.totalBeds ||
      room.bedCount ||
      0
    );

    const fallbackCapacity = capacityRaw > 0 ? capacityRaw : capacityForRoomType(finalType);

    const roomBeds = state.beds.filter((bed) => {
      return belongsToRoom(bed, room.id, finalRoomNo, propertyId, propertyName);
    });

    const roomBedIds = new Set(roomBeds.map((bed) => bed.id));
    const roomBedNos = new Set(
      roomBeds
        .map((bed) => normalizeComparable(valueText(bed, ["bedNo", "bedNumber", "bedName", "name"])))
        .filter(Boolean)
    );

    const resolvedCapacity = Math.max(fallbackCapacity, roomBeds.length);

    const bookingOccupiesRoom =
      activeRoomIds.has(room.id) ||
      activeRoomNos.has(normalizeComparable(finalRoomNo));

    const occupiedBeds = roomBeds.filter((bed) => {
      const bedStatus = textValue(bed, ["status", "bedStatus"]);
      const bedNo = normalizeComparable(valueText(bed, ["bedNo", "bedNumber", "bedName", "name"]));
      const bookedByBooking =
        activeBedIds.has(bed.id) ||
        activeBedNos.has(bedNo);

      return isOccupied(bedStatus) || bed.isOccupied === true || bookedByBooking;
    }).length;

    const availableBeds = roomBeds.filter((bed) => {
      const bedStatus = textValue(bed, ["status", "bedStatus"]);
      const bedNo = normalizeComparable(valueText(bed, ["bedNo", "bedNumber", "bedName", "name"]));
      const bookedByBooking =
        activeBedIds.has(bed.id) ||
        activeBedNos.has(bedNo);

      return isAvailable(bedStatus) && bed.isOccupied !== true && !bookedByBooking;
    }).length;

    const rawStatus = textValue(room, ["status", "roomStatus"]);
    const normalizedStatus = statusNormalize(rawStatus);

    const fallbackOccupiedBeds =
      roomBeds.length === 0 && (bookingOccupiesRoom || isOccupied(normalizedStatus))
        ? resolvedCapacity
        : occupiedBeds;

    const fallbackAvailableBeds =
      roomBeds.length === 0 && !bookingOccupiesRoom && isAvailable(normalizedStatus)
        ? resolvedCapacity
        : availableBeds;

    let revenue = 0;
    let monthlyRevenue = 0;

    state.bookings.forEach((booking) => {
      const belongs =
        belongsToRoom(booking, room.id, finalRoomNo, propertyId, propertyName) ||
        roomBedIds.has(valueText(booking, ["bedId", "bed_id"])) ||
        roomBedNos.has(normalizeComparable(valueText(booking, ["bedNo", "bedNumber", "bedName"])));

      if (!belongs) return;
      if (isCancelled(textValue(booking, ["status", "bookingStatus"]))) return;

      const amount = bookingAmount(booking);
      revenue += amount;

      const date = dateFromData(booking, ["createdAt", "created_at", "bookingDate", "checkIn", "check_in"]);
      if (date && date >= startOfMonth) {
        monthlyRevenue += amount;
      }
    });

    const finalStatus =
      bookingOccupiesRoom && !isMaintenance(normalizedStatus) && !isInactive(normalizedStatus)
        ? "Occupied"
        : cleanLabel(normalizedStatus);

    return {
      id: room.id,
      raw: room,
      propertyId,
      propertyName,
      roomNo: finalRoomNo,
      coolingType: finalCooling,
      roomType: finalType,
      sharingCapacity: resolvedCapacity,
      status: finalStatus,
      description: valueText(room, ["description", "desc", "roomDescription"]),
      availableBeds: fallbackAvailableBeds,
      occupiedBeds: fallbackOccupiedBeds,
      revenue,
      monthlyRevenue
    };
  });
}

function calculateAnalytics() {
  const rooms = buildRoomRecords();

  const totalRooms = rooms.length;
  const availableRooms = rooms.filter((room) => isAvailable(room.status)).length;
  const occupiedRooms = rooms.filter((room) => isOccupied(room.status)).length;
  const maintenanceRooms = rooms.filter((room) => isMaintenance(room.status)).length;

  const totalCapacity = rooms.reduce((sum, room) => sum + room.sharingCapacity, 0);
  const availableBeds = rooms.reduce((sum, room) => sum + room.availableBeds, 0);
  const occupiedBeds = rooms.reduce((sum, room) => sum + room.occupiedBeds, 0);

  const occupancyRate = totalCapacity ? Math.round((occupiedBeds / totalCapacity) * 100) : 0;

  const totalRevenue = rooms.reduce((sum, room) => sum + room.revenue, 0);
  const monthlyRevenue = rooms.reduce((sum, room) => sum + room.monthlyRevenue, 0);

  return {
    rooms,
    totalRooms,
    availableRooms,
    occupiedRooms,
    maintenanceRooms,
    totalCapacity,
    availableBeds,
    occupiedBeds,
    occupancyRate,
    totalRevenue,
    monthlyRevenue,
    revenueTrend: monthlyRevenueTrend()
  };
}

function monthLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short" });
}

function lastSixMonths() {
  const now = new Date();

  return Array.from({ length: 6 }, (_, index) => {
    const monthBack = 5 - index;
    return new Date(now.getFullYear(), now.getMonth() - monthBack, 1);
  });
}

function monthlyRevenueTrend() {
  const months = lastSixMonths();
  const values = Array(6).fill(0);
  const now = new Date();

  state.bookings.forEach((booking) => {
    const date = dateFromData(booking, ["createdAt", "created_at", "bookingDate", "checkIn", "check_in"]);
    if (!date) return;

    if (isCancelled(textValue(booking, ["status", "bookingStatus"]))) return;

    const monthsAgo = ((now.getFullYear() - date.getFullYear()) * 12) + now.getMonth() - date.getMonth();

    if (monthsAgo >= 0 && monthsAgo < 6) {
      values[5 - monthsAgo] += bookingAmount(booking);
    }
  });

  return months.map((date, index) => ({
    label: monthLabel(date),
    value: values[index]
  }));
}

function countByLabel(items, labelGetter) {
  const map = new Map();

  items.forEach((item) => {
    const label = cleanLabel(labelGetter(item) || "Unknown");
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].sort((a, b) => b[1] - a[1]);
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

  propertiesDropdown?.classList.add("active");

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

  profileBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    profileDropdown?.classList.toggle("show");
  });

  profileDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  propertiesToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    propertiesDropdown?.classList.toggle("active");
    profileDropdown?.classList.remove("show");
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
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("rooms", COLLECTIONS.rooms);
  listenCollection("beds", COLLECTIONS.beds);
  listenCollection("bookings", COLLECTIONS.bookings);
}

function renderPage() {
  renderAddPropertyOptions();
  renderFilters();
  renderStats();
  renderCharts();
  renderLists();
  renderSideBars();
}

function renderStats() {
  const data = calculateAnalytics();

  const availablePercent = data.totalRooms
    ? Math.round((data.availableRooms / data.totalRooms) * 100)
    : 0;

  const occupiedPercent = data.totalCapacity
    ? Math.round((data.occupiedBeds / data.totalCapacity) * 100)
    : 0;

  setText("totalRoomsValue", data.totalRooms);
  setText("availableRoomsValue", data.availableRooms);
  setText("occupiedRoomsValue", data.occupiedRooms);
  setText("totalCapacityValue", data.totalCapacity);
  setText("monthlyRevenueValue", money(data.monthlyRevenue));
  setText("totalRevenueValue", `Total ${money(data.totalRevenue)}`);
  setText("availableRoomsPercent", `${availablePercent}% ready to assign`);
  setText("occupiedRoomsPercent", `${occupiedPercent}% occupancy`);
  setText("capacitySub", `${data.availableBeds} available beds`);
}

function renderFilters() {
  const rooms = buildRoomRecords();

  const propertyFilter = $("propertyFilter");
  const statusFilter = $("statusFilter");
  const coolingFilter = $("coolingFilter");
  const roomTypeFilter = $("roomTypeFilter");

  const selectedProperty = propertyFilter?.value || "All";
  const selectedStatus = statusFilter?.value || "All";
  const selectedCooling = coolingFilter?.value || "All";
  const selectedType = roomTypeFilter?.value || "All";

  const properties = ["All", ...new Set(rooms.map((room) => room.propertyName).filter(Boolean))];
  const statuses = ["All", ...new Set(rooms.map((room) => room.status).filter(Boolean))];
  const coolingTypes = ["All", ...new Set(rooms.map((room) => room.coolingType).filter(Boolean))];
  const roomTypes = ["All", ...new Set(rooms.map((room) => room.roomType).filter(Boolean))];

  if (propertyFilter) {
    propertyFilter.innerHTML = properties.map((item) => `
      <option value="${escapeHtml(item)}">
        ${escapeHtml(item === "All" ? "All Properties" : item)}
      </option>
    `).join("");
    propertyFilter.value = properties.includes(selectedProperty) ? selectedProperty : "All";
  }

  if (statusFilter) {
    statusFilter.innerHTML = statuses.map((item) => `
      <option value="${escapeHtml(item)}">
        ${escapeHtml(item === "All" ? "All Status" : item)}
      </option>
    `).join("");
    statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : "All";
  }

  if (coolingFilter) {
    coolingFilter.innerHTML = coolingTypes.map((item) => `
      <option value="${escapeHtml(item)}">
        ${escapeHtml(item === "All" ? "All Cooling" : item)}
      </option>
    `).join("");
    coolingFilter.value = coolingTypes.includes(selectedCooling) ? selectedCooling : "All";
  }

  if (roomTypeFilter) {
    roomTypeFilter.innerHTML = roomTypes.map((item) => `
      <option value="${escapeHtml(item)}">
        ${escapeHtml(item === "All" ? "All Room Types" : item)}
      </option>
    `).join("");
    roomTypeFilter.value = roomTypes.includes(selectedType) ? selectedType : "All";
  }
}

function getFilteredRooms() {
  let rooms = buildRoomRecords();

  const search = normalize($("roomSearchInput")?.value || $("globalSearchInput")?.value || "");
  const propertyFilter = $("propertyFilter")?.value || "All";
  const statusFilter = $("statusFilter")?.value || "All";
  const coolingFilter = $("coolingFilter")?.value || "All";
  const roomTypeFilter = $("roomTypeFilter")?.value || "All";

  if (search) {
    rooms = rooms.filter((room) => {
      return [
        room.roomNo,
        room.propertyName,
        room.description,
        room.status,
        room.coolingType,
        room.roomType
      ].join(" ").toLowerCase().includes(search);
    });
  }

  if (propertyFilter !== "All") {
    rooms = rooms.filter((room) => room.propertyName === propertyFilter);
  }

  if (statusFilter !== "All") {
    rooms = rooms.filter((room) => room.status === statusFilter);
  }

  if (coolingFilter !== "All") {
    rooms = rooms.filter((room) => room.coolingType === coolingFilter);
  }

  if (roomTypeFilter !== "All") {
    rooms = rooms.filter((room) => room.roomType === roomTypeFilter);
  }

  return rooms;
}

function createChart(id, config) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return;

  if (state.charts[id]) {
    state.charts[id].destroy();
  }

  state.charts[id] = new Chart(canvas, config);
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

function renderCharts() {
  const data = calculateAnalytics();
  const statusRows = countByLabel(data.rooms, (room) => room.status)
    .map(([label, count], index) => [label, count, chartColor(index)]);

  setText("statusChartTotal", data.totalRooms);

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
        legend: { display: false }
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
        const percent = data.totalRooms ? Math.round((count / data.totalRooms) * 100) : 0;

        return `
          <div class="legend-row">
            <span><i class="legend-dot" style="background:${color}"></i>${escapeHtml(label)}</span>
            <strong>${count} (${percent}%)</strong>
          </div>
        `;
      }).join("");
    }
  }

  renderRevenueTrend(data.revenueTrend);
}

function renderRevenueTrend(points) {
  const container = $("revenueTrendChart");
  if (!container) return;

  const maxValue = Math.max(...points.map((item) => item.value), 1);

  container.innerHTML = points.map((point, index) => {
    const height = Math.max(4, Math.round((point.value / maxValue) * 100));
    const color = index % 2 === 0 ? COLORS.gold : COLORS.navy;

    return `
      <div class="trend-bar">
        <strong>${money(point.value)}</strong>
        <div class="trend-track">
          <div class="trend-fill" style="height:${height}%;background:${color}"></div>
        </div>
        <span>${escapeHtml(point.label)}</span>
      </div>
    `;
  }).join("");
}

function renderSideBars() {
  const data = calculateAnalytics();

  renderBarList("roomTypeMixList", countByLabel(data.rooms, (room) => room.roomType), false);
  renderBarList("coolingMixList", countByLabel(data.rooms, (room) => room.coolingType), false);
  renderBarList("propertyDistributionList", countByLabel(data.rooms, (room) => room.propertyName || "Unknown Property"), false);

  const overview = $("occupancyOverview");
  if (overview) {
    overview.innerHTML = `
      <div class="mini-stat">
        <span>Total Capacity</span>
        <strong>${data.totalCapacity}</strong>
      </div>

      <div class="mini-stat">
        <span>Occupied Beds</span>
        <strong>${data.occupiedBeds}</strong>
      </div>

      <div class="mini-stat">
        <span>Available Beds</span>
        <strong>${data.availableBeds}</strong>
      </div>

      <div class="mini-stat">
        <span>Occupancy Rate</span>
        <strong>${data.occupancyRate}%</strong>
      </div>
    `;
  }
}

function renderBarList(id, rows, isMoney) {
  const container = $(id);
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `<div class="empty-card">No data yet.</div>`;
    return;
  }

  const max = Math.max(...rows.map((item) => item[1]), 1);

  container.innerHTML = rows.slice(0, 6).map(([label, value], index) => {
    const percent = Math.max(4, Math.round((value / max) * 100));
    const color = chartColor(index);

    return `
      <div class="bar-row">
        <label>${escapeHtml(label)}</label>
        <div class="bar-track">
          <div class="bar-fill" style="width:${percent}%;background:${color}"></div>
        </div>
        <strong>${isMoney ? money(value) : value}</strong>
      </div>
    `;
  }).join("");
}

function renderLists() {
  const list = $("roomCardsList");
  if (!list) return;

  const rooms = getFilteredRooms();
  state.filteredRooms = rooms;

  const totalPages = Math.max(1, Math.ceil(rooms.length / state.rowsPerPage));
  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const paginated = rooms.slice(start, start + state.rowsPerPage);

  setText("roomShownCount", `${rooms.length} shown`);

  if (!paginated.length) {
    list.innerHTML = `
      <div class="empty-card">
        No rooms found. Add a room or change your filters.
      </div>
    `;

    setText("tableSummary", "Showing 0 rooms");
    renderPagination(totalPages);
    return;
  }

  list.innerHTML = paginated.map((room) => {
    const color = roomStatusColor(room.status);
    const progress = room.sharingCapacity <= 0
      ? 0
      : Math.min(100, Math.round((room.occupiedBeds / room.sharingCapacity) * 100));

    return `
      <article class="room-card">
        <div class="room-soft-icon" style="background:${color}18;color:${color}">
          <i class="fa-solid fa-door-open"></i>
        </div>

        <div>
          <h4>Room ${escapeHtml(room.roomNo)}</h4>

          <p>${escapeHtml(room.propertyName || "No property linked")}</p>

          ${
            room.description
              ? `<p class="desc">${escapeHtml(room.description)}</p>`
              : ""
          }

          <div class="room-chip-row">
            <span class="tiny-chip" style="background:${COLORS.gold}14;color:${COLORS.gold}">
              ${escapeHtml(room.status)}
            </span>

            <span class="tiny-chip" style="background:${COLORS.navy}12;color:${COLORS.navy}">
              ${escapeHtml(room.coolingType)}
            </span>

            <span class="tiny-chip" style="background:${COLORS.burgundy}12;color:${COLORS.burgundy}">
              ${escapeHtml(room.roomType)}
            </span>

            <span class="tiny-chip" style="background:${COLORS.green}12;color:${COLORS.green}">
              ${room.occupiedBeds}/${room.sharingCapacity} beds
            </span>

            <span class="tiny-chip" style="background:${COLORS.purple}12;color:${COLORS.purple}">
              ${money(room.revenue)}
            </span>
          </div>

          <div class="occupancy-row">
            <div class="occupancy-track">
              <div class="occupancy-fill" style="width:${progress}%;background:${progress >= 80 ? COLORS.green : progress >= 50 ? COLORS.gold : COLORS.burgundy}"></div>
            </div>
            <strong>${progress}%</strong>
          </div>
        </div>

        <div class="card-actions">
          <button class="delete-action" type="button" data-delete-id="${escapeHtml(room.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const room = buildRoomRecords().find((item) => item.id === button.dataset.deleteId);
      if (room) confirmDeleteRoom(room);
    });
  });

  setText("tableSummary", `Showing ${start + 1} to ${start + paginated.length} of ${rooms.length} rooms`);
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
    renderLists();
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
      renderLists();
    });
    container.appendChild(button);
  }

  const next = document.createElement("button");
  next.type = "button";
  next.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
  next.disabled = state.currentPage === totalPages;
  next.addEventListener("click", () => {
    state.currentPage += 1;
    renderLists();
  });

  container.appendChild(next);
}

function renderAddPropertyOptions() {
  const select = $("addPropertySelect");
  if (!select) return;

  const current = select.value;

  select.innerHTML = `
    <option value="">Select property</option>
    ${state.properties.map((property) => `
      <option value="${escapeHtml(property.id)}">
        ${escapeHtml(propertyDisplayName(property, property.id))}
      </option>
    `).join("")}
  `;

  if (state.properties.some((property) => property.id === current)) {
    select.value = current;
  }
}

function updateCapacityPreview() {
  const roomTypeValue = $("addRoomType")?.value || "Single Sharing";
  const capacity = capacityForRoomType(roomTypeValue);

  const preview = $("capacityPreview");
  if (!preview) return;

  preview.innerHTML = `
    <i class="fa-solid fa-bed"></i>
    <div>
      <strong>Capacity Auto-Fetch</strong>
      <p>${cleanLabel(roomTypeValue)} creates ${capacity} bed${capacity === 1 ? "" : "s"} capacity.</p>
    </div>
  `;
}

function openAddRoomModal() {
  $("addRoomForm")?.reset();
  $("addRoomModal").hidden = false;
  document.body.style.overflow = "hidden";

  renderAddPropertyOptions();
  updateCapacityPreview();
}

function closeAddRoomModal() {
  if (state.saving) return;

  $("addRoomModal").hidden = true;
  document.body.style.overflow = "";
}

async function saveRoom(event) {
  event.preventDefault();

  const propertyId = $("addPropertySelect")?.value || "";
  const property = state.properties.find((item) => item.id === propertyId);

  if (!property) {
    toast("Please select a property first.", true);
    return;
  }

  const roomNo = $("addRoomNo")?.value.trim() || "";
  const coolingType = $("addCoolingType")?.value || "AC";
  const selectedRoomType = $("addRoomType")?.value || "Single Sharing";
  const status = $("addRoomStatus")?.value || "available";
  const description = $("addRoomDescription")?.value.trim() || "";
  const roomName = `Room ${roomNo}`;
  const capacity = capacityForRoomType(selectedRoomType);
  const propertyName = propertyDisplayName(property, property.id);

  if (!roomNo) {
    toast("Room No is required.", true);
    $("addRoomNo")?.focus();
    return;
  }

  state.saving = true;
  $("saveRoomBtn").disabled = true;
  $("saveRoomBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const batch = writeBatch(db);

    const roomRef = doc(collection(db, COLLECTIONS.rooms));

    batch.set(roomRef, {
      propertyId,
      propertyName,
      roomNo,
      roomNumber: roomNo,
      roomName,
      name: roomName,
      coolingType,
      roomCooling: coolingType,
      roomType: selectedRoomType,
      sharingType: selectedRoomType,
      sharingCapacity: capacity,
      capacity,
      totalBeds: capacity,
      description,
      status,
      roomStatus: status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "New room added",
      message: `${roomName} was added to ${propertyName}.`,
      type: "room",
      module: "Rooms",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    toast("Room saved successfully.");
    closeAddRoomModal();
  } catch (error) {
    console.error("Save room failed:", error);
    toast(error?.message || "Failed to save room. Check Firebase rules.", true);
  } finally {
    state.saving = false;
    $("saveRoomBtn").disabled = false;
    $("saveRoomBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Room`;
  }
}

async function confirmDeleteRoom(room) {
  const ok = confirm(
    `Delete Room ${room.roomNo}?\n\nThis will delete the room and all beds linked to this room. Bookings will not be deleted.`
  );

  if (!ok) return;

  try {
    const relatedBeds = state.beds.filter((bed) => {
      return belongsToRoom(bed, room.id, room.roomNo, room.propertyId, room.propertyName);
    });

    const batch = writeBatch(db);

    relatedBeds.forEach((bed) => {
      batch.delete(doc(db, COLLECTIONS.beds, bed.id));
    });

    batch.delete(doc(db, COLLECTIONS.rooms, room.id));

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "Room deleted",
      message: `Room ${room.roomNo} was deleted from ${room.propertyName} with ${relatedBeds.length} linked beds.`,
      type: "room",
      module: "Rooms",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    toast(`Deleted Room ${room.roomNo} with ${relatedBeds.length} linked beds.`);
  } catch (error) {
    console.error("Delete room failed:", error);
    toast(error?.message || "Failed to delete room.", true);
  }
}

function exportRoomsCsv() {
  const rooms = getFilteredRooms();

  const rows = [
    ["Room No", "Property", "Cooling Type", "Room Type", "Capacity", "Available Beds", "Occupied Beds", "Status", "Revenue", "Description"],
    ...rooms.map((room) => [
      room.roomNo,
      room.propertyName,
      room.coolingType,
      room.roomType,
      room.sharingCapacity,
      room.availableBeds,
      room.occupiedBeds,
      room.status,
      room.revenue,
      room.description
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
  link.download = "rooms.csv";
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
  ["roomSearchInput", "globalSearchInput"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      state.currentPage = 1;
      renderLists();
    });
  });

  ["propertyFilter", "statusFilter", "coolingFilter", "roomTypeFilter"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      state.currentPage = 1;
      renderLists();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("roomSearchInput").value = "";
    $("globalSearchInput").value = "";
    $("propertyFilter").value = "All";
    $("statusFilter").value = "All";
    $("coolingFilter").value = "All";
    $("roomTypeFilter").value = "All";

    state.currentPage = 1;
    renderLists();
  });

  $("addRoomBtn")?.addEventListener("click", openAddRoomModal);
  $("quickAddRoom")?.addEventListener("click", openAddRoomModal);

  $("closeAddRoomBtn")?.addEventListener("click", closeAddRoomModal);
  $("cancelAddRoomBtn")?.addEventListener("click", closeAddRoomModal);

  $("addRoomModal")?.addEventListener("click", (event) => {
    if (event.target.id === "addRoomModal") {
      closeAddRoomModal();
    }
  });

  $("addRoomForm")?.addEventListener("submit", saveRoom);

  $("reloadPropertiesBtn")?.addEventListener("click", () => {
    renderAddPropertyOptions();
    toast("Properties refreshed.");
  });

  $("addRoomType")?.addEventListener("change", updateCapacityPreview);

  $("quickAllRooms")?.addEventListener("click", () => {
    $("statusFilter").value = "All";
    state.currentPage = 1;
    renderLists();
  });

  $("quickAvailableRooms")?.addEventListener("click", () => {
    $("statusFilter").value = "Available";
    state.currentPage = 1;
    renderLists();
  });

  $("quickMaintenance")?.addEventListener("click", () => {
    $("statusFilter").value = "Maintenance";
    state.currentPage = 1;
    renderLists();
  });

  $("exportBtn")?.addEventListener("click", exportRoomsCsv);

  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    toast("Rooms refreshed.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});