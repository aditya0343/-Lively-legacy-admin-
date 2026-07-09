import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const state = {
  properties: [],
  rooms: [],
  beds: [],
  selectedPropertyId: "all",
  charts: {}
};

const COLORS = {
  gold: "#d09112",
  navy: "#08233f",
  green: "#22a55a",
  red: "#ef4444",
  purple: "#6642aa",
  blue: "#3b82f6",
  orange: "#f97316",
  gray: "#94a3b8"
};

/* HELPERS */

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "Admin").trim();

  if (text.includes("@")) {
    return text.slice(0, 2).toUpperCase();
  }

  const parts = text.split(" ").filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getPropertyName(property) {
  return property.propertyName || property.name || "Property";
}

function getPropertyCode(property) {
  return property.propertyCode || property.propertyId || property.code || "";
}

function getPropertyLocation(property) {
  return property.city || property.location || property.address1 || property.address || "Location not added";
}

function getPropertyImage(property) {
  return property.imageUrl || property.coverImageUrl || property.coverImage?.url || property.image || "";
}

function getPropertyById(propertyId) {
  const key = String(propertyId || "");

  return state.properties.find((property) => {
    return (
      String(property.id) === key ||
      String(property.propertyId || "") === key ||
      String(property.propertyDocId || "") === key ||
      String(property.propertyCode || "") === key ||
      String(property.propertyName || "") === key ||
      String(property.name || "") === key
    );
  });
}

function getPropertyNameById(propertyId) {
  const property = getPropertyById(propertyId);
  return property ? getPropertyName(property) : "Property";
}

function getRoomPropertyId(room) {
  return String(
    room.propertyId ||
    room.propertyDocId ||
    room.propertyCode ||
    room.propertyName ||
    ""
  );
}

function getBedPropertyId(bed) {
  return String(
    bed.propertyId ||
    bed.propertyDocId ||
    bed.propertyCode ||
    bed.propertyName ||
    ""
  );
}

function getRoomNumber(room) {
  return room.roomNumber || room.roomNo || room.number || room.name || "-";
}

function getRoomFloor(room) {
  return room.floor || room.floorName || room.floorNumber || room.level || "-";
}

function getRoomType(room) {
  return room.roomType || room.type || room.sharingType || room.category || "Standard";
}

function getRoomTotalBeds(room) {
  return safeNumber(
    room.totalBeds ||
    room.beds ||
    room.bedCount ||
    room.capacity ||
    0
  );
}

function getRoomOccupiedBeds(room) {
  return safeNumber(
    room.occupiedBeds ||
    room.occupied ||
    room.filledBeds ||
    room.currentOccupancy ||
    0
  );
}

function getRoomRent(room) {
  return safeNumber(
    room.bedRent ||
    room.roomRent ||
    room.rent ||
    room.monthlyRent ||
    room.price ||
    0
  );
}

function getRoomForBed(bed) {
  const roomKey = String(bed.roomId || bed.roomDocId || bed.roomNumber || bed.roomNo || "");

  return state.rooms.find((room) => {
    return (
      String(room.id) === roomKey ||
      String(room.roomId || "") === roomKey ||
      String(room.roomNumber || "") === roomKey ||
      String(room.roomNo || "") === roomKey
    );
  });
}

function bedMatchesRoom(bed, room) {
  const bedRoomKey = String(bed.roomId || bed.roomDocId || bed.roomNumber || bed.roomNo || "");

  return (
    bedRoomKey === String(room.id) ||
    bedRoomKey === String(room.roomId || "") ||
    bedRoomKey === String(getRoomNumber(room))
  );
}

function getBedRoomNumber(bed) {
  const room = getRoomForBed(bed);
  return bed.roomNumber || bed.roomNo || room?.roomNumber || room?.roomNo || "-";
}

function getBedFloor(bed) {
  const room = getRoomForBed(bed);
  return bed.floor || bed.floorName || room?.floor || room?.floorName || "-";
}

function getBedRoomType(bed) {
  const room = getRoomForBed(bed);
  return bed.roomType || room?.roomType || room?.type || bed.type || "Standard";
}

function getBedType(bed) {
  return bed.bedType || bed.type || getBedRoomType(bed) || "Standard";
}

function getBedRent(bed) {
  const room = getRoomForBed(bed);

  return safeNumber(
    bed.rent ||
    bed.bedRent ||
    bed.monthlyRent ||
    room?.bedRent ||
    room?.roomRent ||
    room?.rent ||
    0
  );
}

function getBedStatus(bed) {
  const status = normalize(
    bed.status ||
    bed.bedStatus ||
    bed.occupancyStatus ||
    ""
  );

  if (status.includes("maintenance") || status.includes("repair")) return "maintenance";
  if (status.includes("reserved") || status.includes("assigned")) return "reserved";
  if (status.includes("occupied") || status.includes("booked")) return "occupied";
  if (status.includes("available") || status.includes("vacant")) return "available";

  return "available";
}

function matchesSelectedProperty(item) {
  if (state.selectedPropertyId === "all") return true;

  const selected = String(state.selectedPropertyId);

  const itemProperty = String(
    item.propertyId ||
    item.propertyDocId ||
    item.propertyCode ||
    item.propertyName ||
    ""
  );

  return itemProperty === selected;
}

/* AUTH */

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

/* UI */

function setupLayoutControls() {
  const adminApp = $("adminApp");
  const sidebar = $("sidebar");
  const menuBtn = $("menuBtn");
  const mobileOverlay = $("mobileOverlay");

  if (menuBtn && sidebar && adminApp) {
    menuBtn.addEventListener("click", () => {
      if (window.innerWidth <= 950) {
        sidebar.classList.toggle("open");
        mobileOverlay?.classList.toggle("show");
      } else {
        adminApp.classList.toggle("sidebar-collapsed");
      }
    });
  }

  if (mobileOverlay && sidebar) {
    mobileOverlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      mobileOverlay.classList.remove("show");
    });
  }

  const profileBtn = $("adminProfileBtn");
  const profileDropdown = $("profileDropdown");

  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      profileDropdown.classList.toggle("show");
    });

    profileDropdown.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.addEventListener("click", () => {
      profileDropdown.classList.remove("show");
    });
  }

  const propertiesToggle = $("propertiesToggle");
  const propertiesDropdown = $("propertiesDropdown");

  if (propertiesToggle && propertiesDropdown) {
    propertiesToggle.addEventListener("click", () => {
      propertiesDropdown.classList.toggle("active");
    });
  }
}

/* FIREBASE */

function listenCollection(stateKey, collectionName) {
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
    }
  );
}

function setupFirebase() {
  listenCollection("properties", "properties");
  listenCollection("rooms", "rooms");
  listenCollection("beds", "beds");
}

/* BUILD DISPLAY BEDS */

function getAllDisplayBeds() {
  const realBeds = state.beds.map((bed) => ({
    ...bed,
    isVirtual: false
  }));

  const virtualBeds = [];

  state.rooms.forEach((room) => {
    const totalBeds = getRoomTotalBeds(room);
    if (!totalBeds) return;

    const realBedsInRoom = realBeds.filter((bed) => bedMatchesRoom(bed, room));

    for (let index = realBedsInRoom.length; index < totalBeds; index++) {
      const roomNumber = getRoomNumber(room);
      const letter = String.fromCharCode(65 + index);
      const occupiedBeds = getRoomOccupiedBeds(room);

      let status = index < occupiedBeds ? "occupied" : "available";

      if (normalize(room.status || room.roomStatus).includes("maintenance")) {
        status = "maintenance";
      }

      virtualBeds.push({
        id: `virtual-${room.id}-${index}`,
        isVirtual: true,

        propertyId: getRoomPropertyId(room),
        propertyDocId: getRoomPropertyId(room),
        propertyName: room.propertyName || getPropertyNameById(getRoomPropertyId(room)),
        propertyCode: room.propertyCode || "",

        roomId: room.id,
        roomNumber,
        roomNo: roomNumber,

        floor: getRoomFloor(room),
        floorName: getRoomFloor(room),

        roomType: getRoomType(room),

        bedNumber: `${roomNumber}-${letter}`,
        bedNo: `${roomNumber}-${letter}`,
        name: `${roomNumber}-${letter}`,

        bedType: getRoomType(room),
        type: getRoomType(room),

        rent: getRoomRent(room),
        bedRent: getRoomRent(room),
        monthlyRent: getRoomRent(room),

        status,
        bedStatus: status
      });
    }
  });

  return [...realBeds, ...virtualBeds];
}

/* FILTERS */

function getFilteredBeds() {
  let beds = getAllDisplayBeds().filter(matchesSelectedProperty);

  const search = normalize($("globalSearchInput")?.value);
  const floor = $("floorFilter")?.value || "all";
  const roomType = $("roomTypeFilter")?.value || "all";
  const bedType = $("bedTypeFilter")?.value || "all";
  const status = $("statusFilter")?.value || "all";

  if (search) {
    beds = beds.filter((bed) => {
      const haystack = [
        bed.bedNumber,
        bed.bedNo,
        bed.name,
        getBedRoomNumber(bed),
        getBedFloor(bed),
        getBedRoomType(bed),
        getBedType(bed),
        getPropertyNameById(getBedPropertyId(bed)),
        bed.residentName,
        bed.residentPhone
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (floor !== "all") {
    beds = beds.filter((bed) => String(getBedFloor(bed)) === String(floor));
  }

  if (roomType !== "all") {
    beds = beds.filter((bed) => String(getBedRoomType(bed)) === String(roomType));
  }

  if (bedType !== "all") {
    beds = beds.filter((bed) => String(getBedType(bed)) === String(bedType));
  }

  if (status !== "all") {
    beds = beds.filter((bed) => getBedStatus(bed) === status);
  }

  return beds;
}

function getCurrentStats(beds = getFilteredBeds()) {
  const total = beds.length;
  const occupied = beds.filter((bed) => getBedStatus(bed) === "occupied").length;
  const available = beds.filter((bed) => getBedStatus(bed) === "available").length;
  const maintenance = beds.filter((bed) => getBedStatus(bed) === "maintenance").length;
  const reserved = beds.filter((bed) => getBedStatus(bed) === "reserved").length;
  const vacant = available + reserved;

  return {
    total,
    occupied,
    available,
    maintenance,
    reserved,
    vacant,
    occupancy: percent(occupied, total)
  };
}

/* RENDER PAGE */

function renderPage() {
  renderPropertySelector();
  renderFilters();
  renderStats();
  renderTrendChart();
  renderFloorSummary();
  renderRoomTypeChart();
  renderPropertySummary();
  renderVacancyChart();
  renderOccupancySummary();
}

function renderPropertySelector() {
  const container = $("propertySelector");
  if (!container) return;

  const propertyCards = state.properties.map((property) => {
    const propertyId = property.id;
    const name = getPropertyName(property);
    const location = getPropertyLocation(property);
    const image = getPropertyImage(property);

    const propertyBeds = getAllDisplayBeds().filter((bed) => {
      const propertyKey = getBedPropertyId(bed);

      return (
        propertyKey === String(property.id) ||
        propertyKey === String(property.propertyId || "") ||
        propertyKey === String(property.propertyCode || "") ||
        propertyKey === String(property.propertyName || "") ||
        propertyKey === String(property.name || "")
      );
    });

    const stats = getCurrentStats(propertyBeds);

    const thumb = image
      ? `<img class="property-select-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(name)}" />`
      : `
        <div class="property-select-icon">
          <i class="fa-solid fa-building"></i>
        </div>
      `;

    return `
      <button
        class="property-select-card ${state.selectedPropertyId === propertyId ? "active" : ""}"
        type="button"
        data-property-id="${escapeHtml(propertyId)}"
      >
        ${thumb}

        <div>
          <strong>${escapeHtml(name)}</strong>
          <span>Occupancy: ${stats.occupancy}%</span>
        </div>
      </button>
    `;
  }).join("");

  const allStats = getCurrentStats(getAllDisplayBeds());

  container.innerHTML = `
    <button
      class="property-select-card ${state.selectedPropertyId === "all" ? "active" : ""}"
      type="button"
      data-property-id="all"
    >
      <div class="property-select-icon">
        <i class="fa-solid fa-building"></i>
      </div>

      <div>
        <strong>All Properties</strong>
        <span>Overall: ${allStats.occupancy}%</span>
      </div>
    </button>

    ${propertyCards}
  `;

  container.querySelectorAll("[data-property-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPropertyId = button.dataset.propertyId;
      renderPage();
    });
  });
}

function renderFilters() {
  const beds = getAllDisplayBeds().filter(matchesSelectedProperty);

  const floorFilter = $("floorFilter");
  const roomTypeFilter = $("roomTypeFilter");
  const bedTypeFilter = $("bedTypeFilter");

  const selectedFloor = floorFilter?.value || "all";
  const selectedRoomType = roomTypeFilter?.value || "all";
  const selectedBedType = bedTypeFilter?.value || "all";

  const floors = [...new Set(beds.map(getBedFloor).filter((value) => value && value !== "-"))];
  const roomTypes = [...new Set(beds.map(getBedRoomType).filter(Boolean))];
  const bedTypes = [...new Set(beds.map(getBedType).filter(Boolean))];

  if (floorFilter) {
    floorFilter.innerHTML = `
      <option value="all">All Floors</option>
      ${floors.map((floor) => `<option value="${escapeHtml(floor)}">${escapeHtml(floor)}</option>`).join("")}
    `;
    floorFilter.value = floors.includes(selectedFloor) ? selectedFloor : "all";
  }

  if (roomTypeFilter) {
    roomTypeFilter.innerHTML = `
      <option value="all">All Types</option>
      ${roomTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
    `;
    roomTypeFilter.value = roomTypes.includes(selectedRoomType) ? selectedRoomType : "all";
  }

  if (bedTypeFilter) {
    bedTypeFilter.innerHTML = `
      <option value="all">All Types</option>
      ${bedTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
    `;
    bedTypeFilter.value = bedTypes.includes(selectedBedType) ? selectedBedType : "all";
  }
}

function renderStats() {
  const stats = getCurrentStats();

  setText("overallOccupancyValue", `${stats.occupancy}%`);
  setText("overallOccupancySub", `${stats.occupied} occupied beds`);

  setText("occupiedBedsValue", `${stats.occupied} / ${stats.total}`);
  setText("occupiedBedsSub", `${stats.occupancy}% occupancy`);

  setText("availableBedsValue", `${stats.available} / ${stats.total}`);
  setText("availableBedsSub", `${percent(stats.available, stats.total)}% available`);

  setText("maintenanceBedsValue", stats.maintenance);
  setText("maintenanceBedsSub", `${percent(stats.maintenance, stats.total)}% under maintenance`);

  setText("vacantBedsValue", stats.vacant);
  setText("vacantBedsSub", `${percent(stats.vacant, stats.total)}% vacant or reserved`);
}

/* CHARTS */

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

function renderTrendChart() {
  const beds = getFilteredBeds();
  const stats = getCurrentStats(beds);

  const labels = ["01", "05", "10", "15", "20", "25", "30"];
  const current = stats.occupancy;

  const values = labels.map((_, index) => {
    if (!stats.total) return 0;

    const variation = [0, -2, 1, -1, 2, -1, 0][index] || 0;
    return Math.max(0, Math.min(100, current + variation));
  });

  createChart("occupancyTrendChart", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Occupancy %",
          data: values,
          borderColor: COLORS.blue,
          backgroundColor: "rgba(59,130,246,0.10)",
          tension: 0.35,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 5
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
            label: (context) => `Occupancy: ${context.parsed.y}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            callback: (value) => `${value}%`,
            font: { size: 10 }
          },
          grid: {
            color: "#edf0f5"
          }
        },
        x: {
          ticks: {
            font: { size: 10 }
          },
          grid: {
            display: false
          }
        }
      }
    }
  });
}

function renderFloorSummary() {
  const body = $("floorSummaryBody");
  if (!body) return;

  const beds = getFilteredBeds();
  const floors = {};

  beds.forEach((bed) => {
    const floor = getBedFloor(bed);
    const status = getBedStatus(bed);

    if (!floors[floor]) {
      floors[floor] = {
        total: 0,
        occupied: 0,
        available: 0
      };
    }

    floors[floor].total += 1;

    if (status === "occupied") floors[floor].occupied += 1;
    if (status === "available" || status === "reserved") floors[floor].available += 1;
  });

  const rows = Object.entries(floors);

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="4" class="empty-row-small">No floor occupancy data found.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = rows.map(([floor, data]) => {
    const occupancy = percent(data.occupied, data.total);

    return `
      <tr>
        <td>${escapeHtml(floor)}</td>
        <td>${data.occupied} / ${data.total}</td>
        <td>${data.available}</td>
        <td class="progress-cell">
          <div class="progress-line">
            <div class="progress-track">
              <span style="width:${occupancy}%"></span>
            </div>
            <b>${occupancy}%</b>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderRoomTypeChart() {
  const beds = getFilteredBeds();
  const typeMap = {};

  beds.forEach((bed) => {
    const type = getBedRoomType(bed);
    const status = getBedStatus(bed);

    if (!typeMap[type]) {
      typeMap[type] = {
        total: 0,
        occupied: 0
      };
    }

    typeMap[type].total += 1;
    if (status === "occupied") typeMap[type].occupied += 1;
  });

  const labels = Object.keys(typeMap);
  const values = labels.map((label) => typeMap[label].occupied);

  const stats = getCurrentStats(beds);
  setText("roomTypeCenter", `${stats.occupancy}%`);

  createChart("roomTypeChart", {
    type: "doughnut",
    data: {
      labels: labels.length ? labels : ["No Data"],
      datasets: [
        {
          data: values.length && values.some(Boolean) ? values : [1],
          backgroundColor: labels.length
            ? [COLORS.navy, COLORS.gold, COLORS.green, COLORS.purple, COLORS.red, COLORS.blue]
            : ["#edf0f5"],
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

  const legend = $("roomTypeLegend");
  if (!legend) return;

  if (!labels.length) {
    legend.innerHTML = `
      <div class="legend-row">
        <span><i class="legend-dot" style="background:#edf0f5"></i>No Data</span>
        <strong>0</strong>
      </div>
    `;
    return;
  }

  legend.innerHTML = labels.map((label, index) => {
    const item = typeMap[label];
    const occupancy = percent(item.occupied, item.total);
    const color = [COLORS.navy, COLORS.gold, COLORS.green, COLORS.purple, COLORS.red, COLORS.blue][index] || COLORS.gray;

    return `
      <div class="legend-row">
        <span>
          <i class="legend-dot" style="background:${color}"></i>
          ${escapeHtml(label)}
        </span>
        <strong>${item.occupied}/${item.total} (${occupancy}%)</strong>
      </div>
    `;
  }).join("");
}

function renderPropertySummary() {
  const body = $("propertySummaryBody");
  if (!body) return;

  if (!state.properties.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty-row-small">No properties found.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = state.properties.map((property) => {
    const propertyKeyList = [
      String(property.id),
      String(property.propertyId || ""),
      String(property.propertyCode || ""),
      String(property.propertyName || ""),
      String(property.name || "")
    ];

    const beds = getAllDisplayBeds().filter((bed) => {
      return propertyKeyList.includes(String(getBedPropertyId(bed)));
    });

    const stats = getCurrentStats(beds);

    return `
      <tr>
        <td>
          <div class="property-name-cell">
            <strong>${escapeHtml(getPropertyName(property))}</strong>
            <span>${escapeHtml(getPropertyLocation(property))}</span>
          </div>
        </td>
        <td>${stats.total}</td>
        <td>${stats.occupied}</td>
        <td>${stats.available}</td>
        <td>${stats.maintenance}</td>
        <td class="progress-cell">
          <div class="progress-line">
            <div class="progress-track">
              <span style="width:${stats.occupancy}%"></span>
            </div>
            <b>${stats.occupancy}%</b>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderVacancyChart() {
  const beds = getFilteredBeds();
  const stats = getCurrentStats(beds);

  setText("vacancyCenter", stats.total);

  createChart("vacancyChart", {
    type: "doughnut",
    data: {
      labels: ["Available", "Maintenance", "Reserved", "Occupied"],
      datasets: [
        {
          data: [
            stats.available,
            stats.maintenance,
            stats.reserved,
            stats.occupied
          ],
          backgroundColor: [
            COLORS.green,
            COLORS.purple,
            COLORS.orange,
            COLORS.navy
          ],
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

  const legend = $("vacancyLegend");
  if (!legend) return;

  legend.innerHTML = `
    <div class="legend-row">
      <span><i class="legend-dot" style="background:${COLORS.green}"></i>Available</span>
      <strong>${stats.available} (${percent(stats.available, stats.total)}%)</strong>
    </div>

    <div class="legend-row">
      <span><i class="legend-dot" style="background:${COLORS.purple}"></i>Maintenance</span>
      <strong>${stats.maintenance} (${percent(stats.maintenance, stats.total)}%)</strong>
    </div>

    <div class="legend-row">
      <span><i class="legend-dot" style="background:${COLORS.orange}"></i>Reserved</span>
      <strong>${stats.reserved} (${percent(stats.reserved, stats.total)}%)</strong>
    </div>

    <div class="legend-row">
      <span><i class="legend-dot" style="background:${COLORS.navy}"></i>Occupied</span>
      <strong>${stats.occupied} (${percent(stats.occupied, stats.total)}%)</strong>
    </div>
  `;
}

function renderOccupancySummary() {
  const container = $("occupancySummaryList");
  if (!container) return;

  const beds = getFilteredBeds();
  const stats = getCurrentStats(beds);

  const floorMap = {};
  const roomTypeMap = {};
  const propertyMap = {};

  beds.forEach((bed) => {
    const floor = getBedFloor(bed);
    const roomType = getBedRoomType(bed);
    const property = getPropertyNameById(getBedPropertyId(bed));
    const status = getBedStatus(bed);

    if (!floorMap[floor]) floorMap[floor] = { total: 0, occupied: 0 };
    if (!roomTypeMap[roomType]) roomTypeMap[roomType] = { total: 0, occupied: 0 };
    if (!propertyMap[property]) propertyMap[property] = { total: 0, occupied: 0 };

    floorMap[floor].total += 1;
    roomTypeMap[roomType].total += 1;
    propertyMap[property].total += 1;

    if (status === "occupied") {
      floorMap[floor].occupied += 1;
      roomTypeMap[roomType].occupied += 1;
      propertyMap[property].occupied += 1;
    }
  });

  const bestFloor = getBestLabel(floorMap);
  const bestRoomType = getBestLabel(roomTypeMap);
  const bestProperty = getBestLabel(propertyMap);

  container.innerHTML = `
    <div class="summary-item good">
      <i class="fa-solid fa-arrow-trend-up"></i>
      <div>
        <strong>Overall Occupancy</strong>
        <span>${stats.occupancy}% occupied across ${stats.total} beds</span>
      </div>
    </div>

    <div class="summary-item info">
      <i class="fa-solid fa-layer-group"></i>
      <div>
        <strong>Best Performing Floor</strong>
        <span>${escapeHtml(bestFloor.label)} (${bestFloor.rate}% occupancy)</span>
      </div>
    </div>

    <div class="summary-item good">
      <i class="fa-solid fa-building"></i>
      <div>
        <strong>Best Property</strong>
        <span>${escapeHtml(bestProperty.label)} (${bestProperty.rate}% occupancy)</span>
      </div>
    </div>

    <div class="summary-item bad">
      <i class="fa-solid fa-bed"></i>
      <div>
        <strong>Vacant Beds</strong>
        <span>${stats.vacant} vacant / reserved beds available</span>
      </div>
    </div>

    <div class="summary-item info">
      <i class="fa-solid fa-door-open"></i>
      <div>
        <strong>Top Room Type</strong>
        <span>${escapeHtml(bestRoomType.label)} (${bestRoomType.rate}% occupancy)</span>
      </div>
    </div>
  `;
}

function getBestLabel(map) {
  const entries = Object.entries(map);

  if (!entries.length) {
    return {
      label: "No data",
      rate: 0
    };
  }

  const sorted = entries.map(([label, data]) => ({
    label,
    rate: percent(data.occupied, data.total)
  })).sort((a, b) => b.rate - a.rate);

  return sorted[0];
}

/* EXPORT */

function exportCsv(filename) {
  const beds = getFilteredBeds();

  const rows = [
    ["Property", "Room No", "Floor", "Room Type", "Bed No", "Bed Type", "Status", "Rent"],
    ...beds.map((bed) => [
      getPropertyNameById(getBedPropertyId(bed)),
      getBedRoomNumber(bed),
      getBedFloor(bed),
      getBedRoomType(bed),
      bed.bedNumber || bed.bedNo || bed.name || "",
      getBedType(bed),
      getBedStatus(bed),
      getBedRent(bed)
    ])
  ];

  const csv = rows.map((row) => {
    return row
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(",");
  }).join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/* EVENTS */

function setupEvents() {
  [
    "globalSearchInput",
    "timePeriodFilter",
    "floorFilter",
    "roomTypeFilter",
    "bedTypeFilter",
    "statusFilter",
    "trendRangeSelect",
    "floorSummarySelect"
  ].forEach((id) => {
    const element = $(id);

    if (!element) return;

    element.addEventListener("input", renderPage);
    element.addEventListener("change", renderPage);
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    if ($("globalSearchInput")) $("globalSearchInput").value = "";
    if ($("floorFilter")) $("floorFilter").value = "all";
    if ($("roomTypeFilter")) $("roomTypeFilter").value = "all";
    if ($("bedTypeFilter")) $("bedTypeFilter").value = "all";
    if ($("statusFilter")) $("statusFilter").value = "all";
    if ($("timePeriodFilter")) $("timePeriodFilter").value = "this-month";

    renderPage();
  });

  $("exportReportBtn")?.addEventListener("click", () => {
    exportCsv("occupancy-report.csv");
  });

  $("downloadExcelBtn")?.addEventListener("click", () => {
    exportCsv("occupancy-data.csv");
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupAuth();
  setupLayoutControls();
  setupEvents();
  setupFirebase();
});