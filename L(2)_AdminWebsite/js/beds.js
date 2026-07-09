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
  setDoc,
  deleteDoc
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
  soft: "#edf0f5"
};

const state = {
  properties: [],
  rooms: [],
  beds: [],
  bookings: [],
  filteredBeds: [],
  currentPage: 1,
  rowsPerPage: 8,
  charts: {},
  saving: false,
  selectedAddPropertyId: "",
  selectedAddRoomId: "",
  addRows: {}
};

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
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

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return `₹${safeNumber(value).toLocaleString("en-IN", {
    maximumFractionDigits: 0
  })}`;
}

function cleanLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown";

  const upper = raw.toUpperCase();
  if (upper === "PG" || upper === "AC") return upper;

  return raw
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
    .join(" ");
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "Admin").trim();
  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
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

function numberFromData(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    const number = safeNumber(value);
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

function matchesAnyValue(rawValue, targets) {
  const value = normalizeComparable(rawValue);
  if (!value) return false;

  return targets.some((target) => {
    const normalizedTarget = normalizeComparable(target);
    return normalizedTarget && value === normalizedTarget;
  });
}

function propertyName(property) {
  return valueText(property, ["propertyName", "name", "title", "property_name"]) || property.id;
}

function roomNo(room) {
  return valueText(room, ["roomNo", "roomNumber", "roomName", "name"]).replace(/^Room\s+/i, "") || room.id;
}

function bedNo(bed) {
  return valueText(bed, ["bedNo", "bedNumber", "bedName", "name"]).replace(/^Bed\s+/i, "") || bed.id;
}

function roomType(room) {
  return cleanLabel(valueText(room, ["roomType", "sharingType", "type"]) || "Unknown");
}

function bedSharingType(bed, matchedRoom) {
  return cleanLabel(
    valueText(bed, ["bedType", "sharingType", "roomType", "type"]) ||
    valueText(matchedRoom || {}, ["roomType", "sharingType", "type"]) ||
    "Unknown"
  );
}

function capacityForRoomType(type) {
  const value = normalize(type);
  if (value.includes("triple")) return 3;
  if (value.includes("double")) return 2;
  return 1;
}

function roomCapacity(room) {
  const direct = intValue(
    room.sharingCapacity ||
    room.capacity ||
    room.totalBeds ||
    room.bedCount ||
    room.beds ||
    0
  );

  return direct > 0 ? direct : capacityForRoomType(roomType(room));
}

function statusNormalize(value) {
  const status = normalize(value).replaceAll(" ", "_");

  if (["booked", "checked_in", "checked-in", "checkedin", "occupied"].includes(status)) {
    return "occupied";
  }

  if (["under_maintenance", "maintenance", "repair"].includes(status)) {
    return "maintenance";
  }

  if (["inactive", "disabled", "closed"].includes(status)) {
    return "inactive";
  }

  if (["reserved", "assigned"].includes(status)) {
    return "reserved";
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
  return ["maintenance", "under maintenance", "under_maintenance", "repair"].includes(normalize(status));
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

function statusColor(status) {
  const value = normalize(status);
  if (isAvailable(value)) return COLORS.green;
  if (isOccupied(value)) return COLORS.burgundy;
  if (isMaintenance(value)) return COLORS.orange;
  if (isInactive(value)) return COLORS.gray;
  if (value === "reserved") return COLORS.purple;
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
    item.roomName
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

function belongsToProperty(item, property) {
  const targets = [
    property.id,
    property.propertyId,
    property.propertyCode,
    property.propertyName,
    property.name,
    property.title
  ].filter(Boolean);

  return propertyValues(item).some((value) => matchesAnyValue(value, targets));
}

function belongsToRoom(item, room) {
  const targets = [
    room.id,
    room.roomId,
    roomNo(room),
    `Room ${roomNo(room)}`
  ].filter(Boolean);

  const roomMatch = roomValues(item).some((value) => matchesAnyValue(value, targets));
  if (!roomMatch) return false;

  const property = state.properties.find((itemProperty) => {
    return matchesAnyValue(
      valueText(room, ["propertyId", "property_id", "propertyName", "property"]),
      [itemProperty.id, propertyName(itemProperty)]
    );
  });

  if (!property) return true;

  const hasPropertyField = propertyValues(item).length > 0;
  if (!hasPropertyField) return true;

  return belongsToProperty(item, property);
}

function findPropertyForRoom(room) {
  const propertyId = valueText(room, ["propertyId", "property_id", "listingId", "listing_id", "pgId", "pg_id"]);
  const propertyNameFromRoom = valueText(room, ["propertyName", "property", "listingName", "pgName"]);

  return state.properties.find((property) => {
    return matchesAnyValue(propertyId, [property.id, propertyName(property)]) ||
      matchesAnyValue(propertyNameFromRoom, [property.id, propertyName(property)]);
  });
}

function findRoomForBed(bed) {
  const directRoomId = valueText(bed, ["roomId", "room_id"]);

  let matched = state.rooms.find((room) => {
    return matchesAnyValue(directRoomId, [room.id]);
  });

  if (matched) return matched;

  matched = state.rooms.find((room) => belongsToRoom(bed, room));

  return matched || null;
}

function findPropertyForBed(bed, matchedRoom) {
  const propertyId = valueText(bed, ["propertyId", "property_id", "listingId", "listing_id", "pgId", "pg_id"]);
  const propertyNameFromBed = valueText(bed, ["propertyName", "property", "listingName", "pgName"]);

  let matched = state.properties.find((property) => {
    return matchesAnyValue(propertyId, [property.id, propertyName(property)]) ||
      matchesAnyValue(propertyNameFromBed, [property.id, propertyName(property)]);
  });

  if (matched) return matched;

  if (matchedRoom) return findPropertyForRoom(matchedRoom);

  return null;
}

function activeBookingKeys() {
  const bedIds = new Set();
  const bedNos = new Set();
  const roomIds = new Set();
  const roomNos = new Set();

  state.bookings.forEach((booking) => {
    const status = valueText(booking, ["status", "bookingStatus"]);
    if (!isActiveBooking(status) || isCancelled(status)) return;

    const bedId = valueText(booking, ["bedId", "bed_id"]);
    const bedNumber = valueText(booking, ["bedNo", "bedNumber", "bedName"]);
    const roomId = valueText(booking, ["roomId", "room_id"]);
    const roomNumber = valueText(booking, ["roomNo", "roomNumber", "roomName"]);

    if (bedId) bedIds.add(bedId);
    if (bedNumber) bedNos.add(normalizeComparable(bedNumber));
    if (roomId) roomIds.add(roomId);
    if (roomNumber) roomNos.add(normalizeComparable(roomNumber));
  });

  return { bedIds, bedNos, roomIds, roomNos };
}

function bookingBelongsToBed(booking, bedRecord) {
  const directBedMatch =
    bedValues(booking).some((value) => matchesAnyValue(value, [bedRecord.id, bedRecord.bedNo, `Bed ${bedRecord.bedNo}`]));

  if (directBedMatch) return true;

  const roomMatch =
    roomValues(booking).some((value) => matchesAnyValue(value, [bedRecord.roomId, bedRecord.roomNo, `Room ${bedRecord.roomNo}`]));

  const propertyMatch =
    propertyValues(booking).some((value) => matchesAnyValue(value, [bedRecord.propertyId, bedRecord.propertyName]));

  return roomMatch && propertyMatch;
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

function buildBedRecords() {
  const activeKeys = activeBookingKeys();

  return state.beds.map((bed) => {
    const matchedRoom = findRoomForBed(bed);
    const matchedProperty = findPropertyForBed(bed, matchedRoom);

    const finalRoomNo =
      valueText(bed, ["roomNo", "roomNumber", "roomName"]).replace(/^Room\s+/i, "") ||
      (matchedRoom ? roomNo(matchedRoom) : "");

    const finalPropertyName =
      valueText(bed, ["propertyName", "property", "listingName", "pgName"]) ||
      (matchedProperty ? propertyName(matchedProperty) : "");

    const finalPropertyId =
      valueText(bed, ["propertyId", "property_id", "listingId", "listing_id", "pgId", "pg_id"]) ||
      matchedProperty?.id ||
      "";

    const finalRoomId =
      valueText(bed, ["roomId", "room_id"]) ||
      matchedRoom?.id ||
      "";

    const finalBedNo = bedNo(bed);

    const rawStatus = valueText(bed, ["status", "bedStatus"]);
    const isOccupiedFromBooking =
      activeKeys.bedIds.has(bed.id) ||
      activeKeys.bedNos.has(normalizeComparable(finalBedNo)) ||
      (finalRoomId && activeKeys.roomIds.has(finalRoomId)) ||
      (finalRoomNo && activeKeys.roomNos.has(normalizeComparable(finalRoomNo)));

    const normalizedRaw = statusNormalize(rawStatus);

    const finalStatus =
      isOccupiedFromBooking && normalizedRaw !== "maintenance" && normalizedRaw !== "inactive"
        ? "occupied"
        : normalizedRaw;

    const finalSharing = bedSharingType(bed, matchedRoom);
    const finalCapacity =
      intValue(bed.sharingCapacity || bed.capacity || bed.totalBeds || 0) ||
      (matchedRoom ? roomCapacity(matchedRoom) : capacityForRoomType(finalSharing));

    const monthlyRent = numberFromData(bed, [
      "monthlyRent",
      "rentAmount",
      "amount",
      "price",
      "bedRent"
    ]);

    let revenue = 0;
    let monthlyRevenue = 0;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    state.bookings.forEach((booking) => {
      if (!bookingBelongsToBed(booking, {
        id: bed.id,
        bedNo: finalBedNo,
        roomId: finalRoomId,
        roomNo: finalRoomNo,
        propertyId: finalPropertyId,
        propertyName: finalPropertyName
      })) return;

      if (isCancelled(valueText(booking, ["status", "bookingStatus"]))) return;

      const amount = bookingAmount(booking);
      revenue += amount;

      const date = dateFromData(booking, ["createdAt", "created_at", "bookingDate", "checkIn", "check_in"]);
      if (date && date >= startOfMonth) monthlyRevenue += amount;
    });

    return {
      id: bed.id,
      raw: bed,
      propertyId: finalPropertyId,
      propertyName: finalPropertyName,
      roomId: finalRoomId,
      roomNo: finalRoomNo,
      bedNo: finalBedNo,
      sharingType: finalSharing,
      capacity: finalCapacity,
      status: finalStatus,
      monthlyRent,
      revenue,
      monthlyRevenue,
      description: valueText(bed, ["description", "notes", "desc"]),
      virtual: false
    };
  });
}

function allRoomsWithBedInfo() {
  return state.rooms.map((room) => {
    const matchedProperty = findPropertyForRoom(room);
    const finalPropertyName =
      valueText(room, ["propertyName", "property", "listingName", "pgName"]) ||
      (matchedProperty ? propertyName(matchedProperty) : "");

    const finalPropertyId =
      valueText(room, ["propertyId", "property_id", "listingId", "listing_id", "pgId", "pg_id"]) ||
      matchedProperty?.id ||
      "";

    const finalRoomNo = roomNo(room);
    const finalRoomType = roomType(room);
    const capacity = roomCapacity(room);

    const existingBeds = state.beds
      .filter((bed) => belongsToRoom(bed, room))
      .map((bed) => ({
        id: bed.id,
        bedNo: bedNo(bed),
        status: statusNormalize(valueText(bed, ["status", "bedStatus"])),
        monthlyRent: numberFromData(bed, ["monthlyRent", "rentAmount", "amount", "price", "bedRent"]),
        description: valueText(bed, ["description", "notes", "desc"])
      }))
      .sort((a, b) => slotSortKey(a.bedNo) - slotSortKey(b.bedNo));

    const expectedBedNumbers = Array.from(
      { length: Math.max(1, capacity || existingBeds.length + 1) },
      (_, index) => String(index + 1)
    );

    return {
      id: room.id,
      propertyId: finalPropertyId,
      propertyName: finalPropertyName,
      roomNo: finalRoomNo,
      roomType: finalRoomType,
      capacity,
      existingBeds,
      expectedBedNumbers,
      existingBedCount: existingBeds.length
    };
  });
}

function slotSortKey(value) {
  const clean = String(value || "").replace(/[^0-9]/g, "");
  return Number(clean) || 999999;
}

function bedInfoFor(room, bedNumber) {
  const target = normalizeComparable(bedNumber);
  return room.existingBeds.find((bed) => normalizeComparable(bed.bedNo) === target) || null;
}

function filteredBedRecords() {
  let beds = buildBedRecords();

  const search = normalize($("bedSearchInput")?.value || $("globalSearchInput")?.value || "");
  const propertyFilter = $("propertyFilter")?.value || "All";
  const roomFilter = $("roomFilter")?.value || "All";
  const statusFilter = $("statusFilter")?.value || "All";
  const sharingFilter = $("sharingFilter")?.value || "All";

  if (search) {
    beds = beds.filter((bed) => {
      return [
        bed.bedNo,
        bed.propertyName,
        bed.roomNo,
        bed.description,
        bed.status,
        bed.sharingType
      ].join(" ").toLowerCase().includes(search);
    });
  }

  if (propertyFilter !== "All") {
    beds = beds.filter((bed) => bed.propertyName === propertyFilter);
  }

  if (roomFilter !== "All") {
    beds = beds.filter((bed) => bed.roomNo === roomFilter);
  }

  if (statusFilter !== "All") {
    beds = beds.filter((bed) => cleanLabel(bed.status) === statusFilter || bed.status === statusFilter);
  }

  if (sharingFilter !== "All") {
    beds = beds.filter((bed) => bed.sharingType === sharingFilter);
  }

  return beds;
}

function calculateAnalytics() {
  const beds = buildBedRecords();

  const totalBeds = beds.length;
  const availableBeds = beds.filter((bed) => isAvailable(bed.status)).length;
  const occupiedBeds = beds.filter((bed) => isOccupied(bed.status)).length;
  const maintenanceBeds = beds.filter((bed) => isMaintenance(bed.status)).length;
  const inactiveBeds = beds.filter((bed) => isInactive(bed.status)).length;

  const totalMonthlyRent = beds.reduce((sum, bed) => sum + bed.monthlyRent, 0);
  const totalRevenue = beds.reduce((sum, bed) => sum + bed.revenue, 0);
  const monthlyRevenue = beds.reduce((sum, bed) => sum + bed.monthlyRevenue, 0);

  return {
    beds,
    totalBeds,
    availableBeds,
    occupiedBeds,
    maintenanceBeds,
    inactiveBeds,
    totalMonthlyRent,
    totalRevenue,
    monthlyRevenue
  };
}

function countByLabel(items, labelGetter) {
  const map = new Map();

  items.forEach((item) => {
    const label = cleanLabel(labelGetter(item) || "Unknown");
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function amountByLabel(items, labelGetter, amountGetter) {
  const map = new Map();

  items.forEach((item) => {
    const label = cleanLabel(labelGetter(item) || "Unknown");
    map.set(label, (map.get(label) || 0) + safeNumber(amountGetter(item)));
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
  renderFilters();
  renderStats();
  renderCharts();
  renderList();
  renderSideBars();
  renderAddFormOptions();
}

function renderStats() {
  const data = calculateAnalytics();
  const total = data.totalBeds || 0;

  const availablePercent = total ? Math.round((data.availableBeds / total) * 100) : 0;
  const occupiedPercent = total ? Math.round((data.occupiedBeds / total) * 100) : 0;
  const maintenancePercent = total ? Math.round((data.maintenanceBeds / total) * 100) : 0;

  setText("totalBedsValue", data.totalBeds);
  setText("availableBedsValue", data.availableBeds);
  setText("occupiedBedsValue", data.occupiedBeds);
  setText("maintenanceBedsValue", data.maintenanceBeds);
  setText("monthlyRevenueValue", money(data.monthlyRevenue));
  setText("totalRevenueValue", `Total ${money(data.totalRevenue)}`);
  setText("availablePercentValue", `${availablePercent}% ready to assign`);
  setText("occupiedPercentValue", `${occupiedPercent}% currently assigned`);
  setText("maintenancePercentValue", `${maintenancePercent}% maintenance`);
}

function renderFilters() {
  const beds = buildBedRecords();

  const propertyFilter = $("propertyFilter");
  const roomFilter = $("roomFilter");
  const statusFilter = $("statusFilter");
  const sharingFilter = $("sharingFilter");

  const selectedProperty = propertyFilter?.value || "All";
  const selectedRoom = roomFilter?.value || "All";
  const selectedStatus = statusFilter?.value || "All";
  const selectedSharing = sharingFilter?.value || "All";

  const properties = ["All", ...new Set(beds.map((bed) => bed.propertyName).filter(Boolean))];
  const rooms = ["All", ...new Set(beds.map((bed) => bed.roomNo).filter(Boolean))];
  const statuses = ["All", ...new Set(beds.map((bed) => cleanLabel(bed.status)).filter(Boolean))];
  const sharings = ["All", ...new Set(beds.map((bed) => bed.sharingType).filter(Boolean))];

  if (propertyFilter) {
    propertyFilter.innerHTML = properties.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item === "All" ? "All Properties" : item)}</option>`).join("");
    propertyFilter.value = properties.includes(selectedProperty) ? selectedProperty : "All";
  }

  if (roomFilter) {
    roomFilter.innerHTML = rooms.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item === "All" ? "All Rooms" : `Room ${item}`)}</option>`).join("");
    roomFilter.value = rooms.includes(selectedRoom) ? selectedRoom : "All";
  }

  if (statusFilter) {
    statusFilter.innerHTML = statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item === "All" ? "All Status" : item)}</option>`).join("");
    statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : "All";
  }

  if (sharingFilter) {
    sharingFilter.innerHTML = sharings.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item === "All" ? "All Sharing" : item)}</option>`).join("");
    sharingFilter.value = sharings.includes(selectedSharing) ? selectedSharing : "All";
  }
}

function createChart(id, config) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return;

  if (state.charts[id]) {
    state.charts[id].destroy();
  }

  state.charts[id] = new Chart(canvas, config);
}

function renderCharts() {
  const data = calculateAnalytics();
  const beds = data.beds;

  const statusCounts = [
    ["Available", data.availableBeds, COLORS.green],
    ["Occupied", data.occupiedBeds, COLORS.burgundy],
    ["Maintenance", data.maintenanceBeds, COLORS.orange],
    ["Inactive", data.inactiveBeds, COLORS.gray]
  ].filter((item) => item[1] > 0);

  renderDonutChart("statusChart", statusCounts, "statusLegend", data.totalBeds);
  setText("statusChartTotal", data.totalBeds);

  const sharingCounts = countByLabel(beds, (bed) => bed.sharingType)
    .map(([label, count], index) => [label, count, chartColor(index)]);

  renderDonutChart("sharingChart", sharingCounts, "sharingLegend", data.totalBeds);
  setText("sharingChartTotal", data.totalBeds);
}

function chartColor(index) {
  return [COLORS.gold, COLORS.navy, COLORS.burgundy, COLORS.green, COLORS.purple, COLORS.orange][index % 6];
}

function renderDonutChart(chartId, rows, legendId, total) {
  const labels = rows.length ? rows.map((item) => item[0]) : ["No Data"];
  const values = rows.length ? rows.map((item) => item[1]) : [1];
  const colors = rows.length ? rows.map((item) => item[2]) : [COLORS.soft];

  createChart(chartId, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
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

  const legend = $(legendId);
  if (!legend) return;

  if (!rows.length) {
    legend.innerHTML = `
      <div class="legend-row">
        <span><i class="legend-dot" style="background:${COLORS.soft}"></i>No data</span>
        <strong>0</strong>
      </div>
    `;
    return;
  }

  legend.innerHTML = rows.map(([label, count, color]) => {
    const percent = total ? Math.round((count / total) * 100) : 0;

    return `
      <div class="legend-row">
        <span><i class="legend-dot" style="background:${color}"></i>${escapeHtml(label)}</span>
        <strong>${count} (${percent}%)</strong>
      </div>
    `;
  }).join("");
}

function renderSideBars() {
  const data = calculateAnalytics();
  const beds = data.beds;

  renderBarList(
    "propertyDistribution",
    countByLabel(beds, (bed) => bed.propertyName || "Unknown Property"),
    false
  );

  renderBarList(
    "rentByStatusList",
    amountByLabel(beds, (bed) => bed.status, (bed) => bed.monthlyRent),
    true
  );
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

function renderList() {
  const body = $("bedCardsList");
  if (!body) return;

  const beds = filteredBedRecords();

  state.filteredBeds = beds;

  const totalPages = Math.max(1, Math.ceil(beds.length / state.rowsPerPage));
  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const paginated = beds.slice(start, start + state.rowsPerPage);

  setText("bedShownCount", `${beds.length} shown`);

  if (!paginated.length) {
    body.innerHTML = `
      <div class="empty-card">
        No beds found. Add a bed or change your filters.
      </div>
    `;

    setText("tableSummary", "Showing 0 beds");
    renderPagination(totalPages);
    return;
  }

  body.innerHTML = paginated.map((bed) => {
    const color = statusColor(bed.status);

    return `
      <article class="bed-card">
        <div class="bed-soft-icon" style="background:${color}18;color:${color}">
          <i class="fa-solid fa-bed"></i>
        </div>

        <div>
          <h4>Bed ${escapeHtml(bed.bedNo)}</h4>

          <p>
            ${escapeHtml(bed.propertyName || "No property linked")} • Room ${escapeHtml(bed.roomNo || "-")}
          </p>

          ${
            bed.description
              ? `<p class="desc">${escapeHtml(bed.description)}</p>`
              : ""
          }

          <div class="bed-chip-row">
            <span class="tiny-chip" style="background:${color}14;color:${color}">
              ${escapeHtml(cleanLabel(bed.status))}
            </span>

            <span class="tiny-chip" style="background:${COLORS.burgundy}14;color:${COLORS.burgundy}">
              ${escapeHtml(bed.sharingType)}
            </span>

            <span class="tiny-chip" style="background:${COLORS.navy}12;color:${COLORS.navy}">
              ${bed.capacity > 0 ? `${bed.capacity} bed room` : "Capacity unknown"}
            </span>

            <span class="tiny-chip" style="background:${COLORS.purple}12;color:${COLORS.purple}">
              Rent ${money(bed.monthlyRent)}
            </span>

            <span class="tiny-chip" style="background:${COLORS.green}12;color:${COLORS.green}">
              Revenue ${money(bed.revenue)}
            </span>
          </div>
        </div>

        <div class="card-actions">
          <button class="edit-action" type="button" data-edit-id="${escapeHtml(bed.id)}">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>

          <button class="delete-action" type="button" data-delete-id="${escapeHtml(bed.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");

  body.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const bed = buildBedRecords().find((item) => item.id === button.dataset.editId);
      if (bed) openEditBed(bed);
    });
  });

  body.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const bed = buildBedRecords().find((item) => item.id === button.dataset.deleteId);
      if (bed) confirmDeleteBed(bed);
    });
  });

  setText("tableSummary", `Showing ${start + 1} to ${start + paginated.length} of ${beds.length} beds`);
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
    renderList();
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
      renderList();
    });
    container.appendChild(button);
  }

  const next = document.createElement("button");
  next.type = "button";
  next.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
  next.disabled = state.currentPage === totalPages;
  next.addEventListener("click", () => {
    state.currentPage += 1;
    renderList();
  });

  container.appendChild(next);
}

function renderAddFormOptions() {
  const propertySelect = $("addPropertySelect");
  if (!propertySelect) return;

  const currentProperty = propertySelect.value || state.selectedAddPropertyId;

  propertySelect.innerHTML = `
    <option value="">Select property</option>
    ${state.properties.map((property) => `
      <option value="${escapeHtml(property.id)}">${escapeHtml(propertyName(property))}</option>
    `).join("")}
  `;

  propertySelect.value = state.properties.some((property) => property.id === currentProperty)
    ? currentProperty
    : "";

  renderAddRoomOptions();
}

function renderAddRoomOptions() {
  const roomSelect = $("addRoomSelect");
  if (!roomSelect) return;

  const propertyId = $("addPropertySelect")?.value || "";
  const rooms = allRoomsWithBedInfo().filter((room) => {
    return room.propertyId === propertyId ||
      matchesAnyValue(room.propertyId, [propertyId]);
  });

  const currentRoom = roomSelect.value || state.selectedAddRoomId;

  roomSelect.innerHTML = `
    <option value="">Select room</option>
    ${rooms.map((room) => {
      const capacityText = room.capacity > 0
        ? `${room.existingBedCount}/${room.capacity} beds`
        : `${room.existingBedCount} beds`;

      return `
        <option value="${escapeHtml(room.id)}">
          Room ${escapeHtml(room.roomNo)} • ${escapeHtml(room.roomType)} • ${escapeHtml(capacityText)}
        </option>
      `;
    }).join("")}
  `;

  roomSelect.value = rooms.some((room) => room.id === currentRoom) ? currentRoom : "";

  renderSelectedRoom();
}

function renderSelectedRoom() {
  const card = $("selectedRoomCard");
  const entryCard = $("bedEntryCard");
  const table = $("bedEntryTable");

  if (!card || !entryCard || !table) return;

  const roomId = $("addRoomSelect")?.value || "";
  const room = allRoomsWithBedInfo().find((item) => item.id === roomId);

  if (!room) {
    card.hidden = true;
    entryCard.hidden = true;
    table.innerHTML = "";
    state.addRows = {};
    return;
  }

  card.hidden = false;
  entryCard.hidden = false;

  card.innerHTML = `
    <h4>Auto-fetched from selected room</h4>
    <div class="bed-chip-row">
      <span class="tiny-chip" style="background:${COLORS.navy}12;color:${COLORS.navy}">
        Room ${escapeHtml(room.roomNo)}
      </span>
      <span class="tiny-chip" style="background:${COLORS.gold}14;color:${COLORS.gold}">
        ${escapeHtml(room.roomType)}
      </span>
      <span class="tiny-chip" style="background:${COLORS.green}12;color:${COLORS.green}">
        ${room.capacity > 0 ? `${room.existingBedCount}/${room.capacity} beds created` : `${room.existingBedCount} beds created`}
      </span>
    </div>
  `;

  table.innerHTML = room.expectedBedNumbers.map((bedNumber) => {
    const existing = bedInfoFor(room, bedNumber);

    if (existing) {
      return `
        <div class="bed-entry-row locked">
          <div class="bed-no-cell">
            <i class="fa-solid fa-lock"></i>
            Bed ${escapeHtml(bedNumber)}
          </div>

          <div class="locked-cell">${money(existing.monthlyRent)}</div>
          <div class="locked-cell">${escapeHtml(cleanLabel(existing.status))}</div>
          <div class="locked-cell">${escapeHtml(existing.description || "Already created")}</div>
        </div>
      `;
    }

    const row = state.addRows[bedNumber] || {
      rent: "",
      status: "available",
      notes: ""
    };

    return `
      <div class="bed-entry-row" data-bed-row="${escapeHtml(bedNumber)}">
        <div class="bed-no-cell">
          <i class="fa-solid fa-bed"></i>
          Bed ${escapeHtml(bedNumber)}
        </div>

        <input
          type="number"
          min="0"
          placeholder="₹ Rent"
          data-bed-rent="${escapeHtml(bedNumber)}"
          value="${escapeHtml(row.rent)}"
        />

        <select data-bed-status="${escapeHtml(bedNumber)}">
          ${["available", "occupied", "maintenance", "inactive"].map((status) => `
            <option value="${status}" ${row.status === status ? "selected" : ""}>
              ${cleanLabel(status)}
            </option>
          `).join("")}
        </select>

        <textarea
          placeholder="Optional notes"
          rows="1"
          data-bed-notes="${escapeHtml(bedNumber)}"
        >${escapeHtml(row.notes)}</textarea>
      </div>
    `;
  }).join("");

  table.querySelectorAll("[data-bed-rent]").forEach((input) => {
    input.addEventListener("input", () => {
      const bedNumber = input.dataset.bedRent;
      state.addRows[bedNumber] = state.addRows[bedNumber] || {};
      state.addRows[bedNumber].rent = input.value;
      state.addRows[bedNumber].status = state.addRows[bedNumber].status || "available";
      state.addRows[bedNumber].notes = state.addRows[bedNumber].notes || "";
    });
  });

  table.querySelectorAll("[data-bed-status]").forEach((input) => {
    input.addEventListener("change", () => {
      const bedNumber = input.dataset.bedStatus;
      state.addRows[bedNumber] = state.addRows[bedNumber] || {};
      state.addRows[bedNumber].status = input.value;
      state.addRows[bedNumber].rent = state.addRows[bedNumber].rent || "";
      state.addRows[bedNumber].notes = state.addRows[bedNumber].notes || "";
    });
  });

  table.querySelectorAll("[data-bed-notes]").forEach((input) => {
    input.addEventListener("input", () => {
      const bedNumber = input.dataset.bedNotes;
      state.addRows[bedNumber] = state.addRows[bedNumber] || {};
      state.addRows[bedNumber].notes = input.value;
      state.addRows[bedNumber].rent = state.addRows[bedNumber].rent || "";
      state.addRows[bedNumber].status = state.addRows[bedNumber].status || "available";
    });
  });
}

function openAddBedModal() {
  state.addRows = {};
  state.selectedAddPropertyId = "";
  state.selectedAddRoomId = "";

  $("addBedForm")?.reset();
  $("addBedModal").hidden = false;
  document.body.style.overflow = "hidden";

  renderAddFormOptions();
}

function closeAddBedModal() {
  if (state.saving) return;

  $("addBedModal").hidden = true;
  document.body.style.overflow = "";
}

async function saveBeds(event) {
  event.preventDefault();

  const propertyId = $("addPropertySelect")?.value || "";
  const roomId = $("addRoomSelect")?.value || "";

  if (!propertyId) {
    toast("Please select a property first.", true);
    return;
  }

  if (!roomId) {
    toast("Please select a room first.", true);
    return;
  }

  const room = allRoomsWithBedInfo().find((item) => item.id === roomId);
  const property = state.properties.find((item) => item.id === propertyId);

  if (!room || !property) {
    toast("Selected property or room could not be found.", true);
    return;
  }

  const rows = [];

  for (const bedNumber of room.expectedBedNumbers) {
    const existing = bedInfoFor(room, bedNumber);
    if (existing) continue;

    const rentInput = document.querySelector(`[data-bed-rent="${CSS.escape(bedNumber)}"]`);
    const statusInput = document.querySelector(`[data-bed-status="${CSS.escape(bedNumber)}"]`);
    const notesInput = document.querySelector(`[data-bed-notes="${CSS.escape(bedNumber)}"]`);

    const rent = safeNumber(rentInput?.value || "");
    const status = statusInput?.value || "available";
    const notes = notesInput?.value?.trim() || "";

    if (!rentInput || !String(rentInput.value || "").trim()) {
      toast(`Please enter rent for Bed No ${bedNumber}.`, true);
      rentInput?.focus();
      return;
    }

    if (rent < 0) {
      toast(`Please enter valid rent for Bed No ${bedNumber}.`, true);
      rentInput?.focus();
      return;
    }

    rows.push({
      bedNo: bedNumber,
      monthlyRent: rent,
      status,
      notes
    });
  }

  if (!rows.length) {
    toast("All bed numbers for this room are already created.", true);
    return;
  }

  if (room.capacity > 0 && room.existingBedCount + rows.length > room.capacity) {
    toast(`This room only allows ${room.capacity} beds. ${room.existingBedCount} already exist.`, true);
    return;
  }

  state.saving = true;
  $("saveBedsBtn").disabled = true;
  $("saveBedsBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const batch = writeBatch(db);

    rows.forEach((row) => {
      const bedRef = doc(collection(db, COLLECTIONS.beds));
      const bedName = `Bed ${row.bedNo}`;

      batch.set(bedRef, {
        propertyId: room.propertyId || property.id,
        propertyName: room.propertyName || propertyName(property),
        roomId: room.id,
        roomNo: room.roomNo,
        roomNumber: room.roomNo,
        roomName: `Room ${room.roomNo}`,
        bedNo: row.bedNo,
        bedNumber: row.bedNo,
        bedName,
        name: bedName,
        bedType: room.roomType,
        sharingType: room.roomType,
        roomType: room.roomType,
        sharingCapacity: room.capacity,
        capacity: room.capacity,
        status: row.status,
        bedStatus: row.status,
        isOccupied: row.status === "occupied",
        monthlyRent: row.monthlyRent,
        rentAmount: row.monthlyRent,
        amount: row.monthlyRent,
        description: row.notes,
        notes: row.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "New beds added",
      message: `${rows.length} bed${rows.length === 1 ? "" : "s"} were added to Room ${room.roomNo} in ${room.propertyName}.`,
      type: "bed",
      module: "Beds",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    toast(`${rows.length} bed${rows.length === 1 ? "" : "s"} saved successfully.`);
    closeAddBedModal();
  } catch (error) {
    console.error("Save beds failed:", error);
    toast(error?.message || "Failed to save beds. Check Firebase rules.", true);
  } finally {
    state.saving = false;
    $("saveBedsBtn").disabled = false;
    $("saveBedsBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Beds`;
  }
}

function openEditBed(bed) {
  $("editBedId").value = bed.id;
  $("editBedTitle").textContent = `Edit Bed ${bed.bedNo}`;
  $("editBedSubtitle").textContent = `${bed.propertyName || "No property"} • Room ${bed.roomNo || "-"}`;
  $("editBedRent").value = bed.monthlyRent || "";
  $("editBedStatus").value = statusNormalize(bed.status);
  $("editBedNotes").value = bed.description || "";

  $("editBedModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeEditBedModal() {
  if (state.saving) return;

  $("editBedModal").hidden = true;
  document.body.style.overflow = "";
}

async function saveEditBed(event) {
  event.preventDefault();

  const bedId = $("editBedId").value;
  const rent = safeNumber($("editBedRent").value);
  const status = $("editBedStatus").value;
  const notes = $("editBedNotes").value.trim();

  const bed = buildBedRecords().find((item) => item.id === bedId);

  if (!bed) {
    toast("Bed record not found.", true);
    return;
  }

  if (rent < 0) {
    toast("Please enter a valid rent.", true);
    return;
  }

  state.saving = true;
  $("saveEditBedBtn").disabled = true;
  $("saveEditBedBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const batch = writeBatch(db);

    batch.set(
      doc(db, COLLECTIONS.beds, bedId),
      {
        status,
        bedStatus: status,
        isOccupied: status === "occupied",
        monthlyRent: rent,
        rentAmount: rent,
        amount: rent,
        description: notes,
        notes,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "Bed updated",
      message: `Bed ${bed.bedNo} in Room ${bed.roomNo} was updated.`,
      type: "bed",
      module: "Beds",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    toast("Bed updated successfully.");
    closeEditBedModal();
  } catch (error) {
    console.error("Edit bed failed:", error);
    toast(error?.message || "Failed to update bed.", true);
  } finally {
    state.saving = false;
    $("saveEditBedBtn").disabled = false;
    $("saveEditBedBtn").innerHTML = `<i class="fa-solid fa-check"></i> Save Changes`;
  }
}

async function confirmDeleteBed(bed) {
  const ok = confirm(`Delete Bed ${bed.bedNo} from Room ${bed.roomNo}?\n\nBookings will not be deleted.`);
  if (!ok) return;

  try {
    const batch = writeBatch(db);

    batch.delete(doc(db, COLLECTIONS.beds, bed.id));

    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      title: "Bed deleted",
      message: `Bed ${bed.bedNo} was deleted from Room ${bed.roomNo} in ${bed.propertyName}.`,
      type: "bed",
      module: "Beds",
      isRead: false,
      adminRead: false,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    toast(`Deleted Bed ${bed.bedNo}.`);
  } catch (error) {
    console.error("Delete bed failed:", error);
    toast(error?.message || "Failed to delete bed.", true);
  }
}

function exportBedsCsv() {
  const beds = filteredBedRecords();

  const rows = [
    ["Bed No", "Property", "Room No", "Sharing Type", "Capacity", "Status", "Monthly Rent", "Revenue", "Notes"],
    ...beds.map((bed) => [
      bed.bedNo,
      bed.propertyName,
      bed.roomNo,
      bed.sharingType,
      bed.capacity,
      cleanLabel(bed.status),
      bed.monthlyRent,
      bed.revenue,
      bed.description
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
  link.download = "beds.csv";
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
  ["bedSearchInput", "globalSearchInput"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      state.currentPage = 1;
      renderList();
    });
  });

  ["propertyFilter", "roomFilter", "statusFilter", "sharingFilter"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      state.currentPage = 1;
      renderList();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("bedSearchInput").value = "";
    $("globalSearchInput").value = "";
    $("propertyFilter").value = "All";
    $("roomFilter").value = "All";
    $("statusFilter").value = "All";
    $("sharingFilter").value = "All";

    state.currentPage = 1;
    renderList();
  });

  $("addBedBtn")?.addEventListener("click", openAddBedModal);
  $("quickAddBed")?.addEventListener("click", openAddBedModal);

  $("closeAddBedBtn")?.addEventListener("click", closeAddBedModal);
  $("cancelAddBedBtn")?.addEventListener("click", closeAddBedModal);

  $("addBedModal")?.addEventListener("click", (event) => {
    if (event.target.id === "addBedModal") closeAddBedModal();
  });

  $("addBedForm")?.addEventListener("submit", saveBeds);

  $("addPropertySelect")?.addEventListener("change", () => {
    state.selectedAddPropertyId = $("addPropertySelect").value;
    state.selectedAddRoomId = "";
    state.addRows = {};
    renderAddRoomOptions();
  });

  $("addRoomSelect")?.addEventListener("change", () => {
    state.selectedAddRoomId = $("addRoomSelect").value;
    state.addRows = {};
    renderSelectedRoom();
  });

  $("reloadFormBtn")?.addEventListener("click", () => {
    renderAddFormOptions();
    toast("Form data refreshed.");
  });

  $("closeEditBedBtn")?.addEventListener("click", closeEditBedModal);
  $("cancelEditBedBtn")?.addEventListener("click", closeEditBedModal);

  $("editBedModal")?.addEventListener("click", (event) => {
    if (event.target.id === "editBedModal") closeEditBedModal();
  });

  $("editBedForm")?.addEventListener("submit", saveEditBed);

  $("quickAllBeds")?.addEventListener("click", () => {
    $("statusFilter").value = "All";
    state.currentPage = 1;
    renderList();
  });

  $("quickAvailableBeds")?.addEventListener("click", () => {
    $("statusFilter").value = "Available";
    state.currentPage = 1;
    renderList();
  });

  $("quickMaintenance")?.addEventListener("click", () => {
    $("statusFilter").value = "Maintenance";
    state.currentPage = 1;
    renderList();
  });

  $("exportBtn")?.addEventListener("click", exportBedsCsv);

  $("refreshBtn")?.addEventListener("click", () => {
    renderPage();
    toast("Beds refreshed.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});