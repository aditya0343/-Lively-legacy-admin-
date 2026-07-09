import { auth, db } from "../../js/firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  deleteDoc,
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

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

const $ = (id) => document.getElementById(id);
const storage = getStorage();

const COLLECTIONS = {
  users: "users",
  staff: "staff",
  staffLoginAccounts: "staff_login_accounts",
  properties: "properties",
  announcements: "announcements",
  notifications: "notifications",
  activityLogs: "activity_logs"
};

const COLORS = {
  navy: "#08233f",
  gold: "#d09112",
  green: "#22a55a",
  red: "#ef4444",
  blue: "#2563eb",
  orange: "#f97316"
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
  activePriority: "High",
  filter: "All Announcements",
  page: 1,
  pageSize: 5,

  userData: null,
  staffRecord: null,
  loginRecord: null,
  propertyRecord: null,

  properties: [],
  announcements: [],
  notifications: [],
  activityLogs: [],

  attachments: [],
  selectedAnnouncementId: "",
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
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return formatDate(date);
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
  return `staff_announcement_read_notification_keys_${session.uid || "guest"}`;
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
    if (auth.currentUser) await signOut(auth);
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

/* PROFILE LOAD */

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
    console.error("Announcement init failed:", error);
    showToast(`Announcement page failed: ${error.message}`, "error");
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

    session.email = firstText([state.userData.email, session.email], "");

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
  const propertyName = getPropertyNameFromSession();

  state.propertyRecord =
    await safeGetDoc(COLLECTIONS.properties, propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyId", propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyCode", propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyName", propertyName) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "name", propertyName);
}

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

function getPropertyNameFromSession() {
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
  ], "");
}

function renderProfileShell() {
  const staffName = getStaffName();
  const email = session.email || "staff@email.com";
  const propertyName = getPropertyNameFromSession();

  setText("staffNameTop", staffName);
  setText("staffEmailTop", email);
  setText("staffAvatarText", getInitials(staffName || email));
  setText("topPropertyText", propertyName || "Create new announcements and view all recent announcements.");
}

/* PROPERTIES */

function propertyName(property) {
  return firstText([
    property?.propertyName,
    property?.name,
    property?.title,
    property?.propertyCode
  ], "Property");
}

function propertyAddress(property) {
  return firstText([
    property?.address,
    property?.propertyAddress,
    property?.fullAddress,
    property?.location,
    property?.city,
    property?.area
  ], "");
}

function propertyLabel(property) {
  const name = propertyName(property);
  const address = propertyAddress(property);

  if (!address || address === name) return name;
  return `${name} - ${address}`;
}

function getPropertyById(id) {
  const key = String(id || "");

  return state.properties.find((property) => {
    return (
      String(property.id || "") === key ||
      String(property.propertyId || "") === key ||
      String(property.propertyCode || "") === key
    );
  });
}

function renderPropertySelect() {
  const select = $("propertySelect");
  if (!select) return;

  let properties = [...state.properties];

  const sessionPropertyName = getPropertyNameFromSession();
  const sessionPropertyId = getPropertyId();

  if (!properties.length && sessionPropertyName) {
    properties = [{
      id: sessionPropertyId || sessionPropertyName,
      propertyName: sessionPropertyName,
      address: sessionPropertyName
    }];
  }

  properties.sort((a, b) => propertyName(a).toLowerCase().localeCompare(propertyName(b).toLowerCase()));

  if (!properties.length) {
    select.innerHTML = `<option value="">No property found</option>`;
    return;
  }

  select.innerHTML = `
    <option value="">Select Property Location</option>
    ${properties.map((property) => `
      <option value="${escapeHtml(property.id)}">
        ${escapeHtml(propertyLabel(property))}
      </option>
    `).join("")}
  `;

  const matched = properties.find((property) => {
    return (
      String(property.id || "") === String(sessionPropertyId) ||
      String(property.propertyId || "") === String(sessionPropertyId) ||
      String(property.propertyName || property.name || "") === String(sessionPropertyName)
    );
  });

  if (matched) {
    select.value = matched.id;
  }
}

/* ANNOUNCEMENTS */

function priorityClean(value) {
  const clean = normalize(value || "Medium");

  if (clean.includes("high") || clean.includes("urgent")) return "High";
  if (clean.includes("low")) return "Low";

  return "Medium";
}

function priorityClass(value) {
  return priorityClean(value).toLowerCase();
}

function priorityIcon(priority) {
  const clean = priorityClass(priority);

  if (clean === "high") return "fa-regular fa-bell";
  if (clean === "low") return "fa-regular fa-circle-check";

  return "fa-solid fa-circle-info";
}

function iconForAnnouncement(item) {
  const text = normalize(`${item.title} ${item.message}`);

  if (text.includes("water") || text.includes("supply")) return "fa-regular fa-bell";
  if (text.includes("gym") || text.includes("maintenance")) return "fa-solid fa-circle-info";
  if (text.includes("event") || text.includes("yoga")) return "fa-regular fa-calendar";
  if (text.includes("parking") || text.includes("cleaning")) return "fa-solid fa-bullhorn";
  if (text.includes("security") || text.includes("protocol")) return "fa-solid fa-shield-halved";

  return priorityIcon(item.priority);
}

function announcementTitle(item) {
  return firstText([item.title, item.announcementTitle, item.heading, item.subject], "Announcement");
}

function announcementMessage(item) {
  return firstText([item.message, item.description, item.body, item.text], "");
}

function announcementAttachments(item) {
  if (Array.isArray(item.attachments)) {
    return item.attachments.map((attachment) => {
      if (typeof attachment === "string") {
        return {
          name: "Attachment",
          url: attachment
        };
      }

      return {
        name: firstText([attachment.name, attachment.fileName], "Attachment"),
        url: firstText([attachment.url, attachment.downloadURL, attachment.link], ""),
        size: Number(attachment.size || 0),
        extension: firstText([attachment.extension, attachment.ext], "")
      };
    });
  }

  if (Array.isArray(item.attachmentUrls)) {
    return item.attachmentUrls.map((url) => ({
      name: "Attachment",
      url: String(url || "")
    }));
  }

  return [];
}

function announcementDate(item) {
  return item.createdAt || item.publishedAt || item.updatedAt || item.date;
}

function recordBelongsToStaffProperty(item) {
  const propertyId = getPropertyId();
  const propertyNameSession = getPropertyNameFromSession();

  if (!propertyId && !propertyNameSession) return true;

  const itemPropertyId = firstText([item.propertyId, item.property_id], "");
  const itemPropertyName = firstText([item.propertyName, item.propertyLocation, item.property], "");

  const propertyMatch =
    propertyId &&
    itemPropertyId &&
    String(itemPropertyId).trim() === String(propertyId).trim();

  const propertyNameMatch =
    propertyNameSession &&
    itemPropertyName &&
    String(itemPropertyName).trim() === String(propertyNameSession).trim();

  return propertyMatch || propertyNameMatch;
}

function filteredAnnouncements() {
  let data = state.announcements
    .filter(recordBelongsToStaffProperty)
    .map((item) => ({
      ...item,
      title: announcementTitle(item),
      message: announcementMessage(item),
      priority: priorityClean(item.priority),
      attachments: announcementAttachments(item)
    }));

  if (state.filter !== "All Announcements") {
    data = data.filter((item) => priorityClean(item.priority) === state.filter);
  }

  return data.sort((a, b) => {
    const dateA = toDate(announcementDate(a))?.getTime() || 0;
    const dateB = toDate(announcementDate(b))?.getTime() || 0;

    return dateB - dateA;
  });
}

function pagedAnnouncements() {
  const data = filteredAnnouncements();
  const start = (state.page - 1) * state.pageSize;

  return data.slice(start, start + state.pageSize);
}

function renderAnnouncements() {
  const container = $("announcementList");
  if (!container) return;

  const data = filteredAnnouncements();
  const paged = pagedAnnouncements();

  const start = data.length ? (state.page - 1) * state.pageSize + 1 : 0;
  const end = Math.min(state.page * state.pageSize, data.length);

  setText("showingText", `Showing ${start} to ${end} of ${data.length} announcements`);

  if (!paged.length) {
    container.innerHTML = `<div class="empty-box">No announcements found.</div>`;
    renderPagination(data.length);
    return;
  }

  container.innerHTML = paged.map((item) => {
    const priority = priorityClean(item.priority);
    const priorityCss = priorityClass(priority);
    const date = announcementDate(item);
    const propertyDisplay = firstText([
      item.propertyName,
      item.propertyLocation,
      item.property,
      "All Properties"
    ], "All Properties");

    return `
      <article class="announcement-item">
        <div class="announcement-icon ${priorityCss}">
          <i class="${escapeHtml(iconForAnnouncement(item))}"></i>
        </div>

        <div class="announcement-content">
          <span class="priority-badge ${priorityCss}">
            ${escapeHtml(priority)}
          </span>

          <strong>${escapeHtml(item.title)}</strong>

          <p>${escapeHtml(item.message)}</p>

          <div class="announcement-meta-line">
            <span>
              <i class="fa-solid fa-people-group"></i>
              Property: ${escapeHtml(propertyDisplay)}
            </span>

            <span>
              <i class="fa-solid fa-paperclip"></i>
              ${item.attachments.length} attachment(s)
            </span>
          </div>
        </div>

        <div class="announcement-date">
          <span>
            <i class="fa-regular fa-calendar"></i>
            ${escapeHtml(formatDate(date))}
          </span>

          <span>
            <i class="fa-regular fa-clock"></i>
            ${escapeHtml(formatTime(date))}
          </span>
        </div>

        <button type="button" class="more-btn" data-announcement-id="${escapeHtml(item.id)}">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      </article>
    `;
  }).join("");

  renderPagination(data.length);
}

function renderPagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  const prev = $("prevPageBtn");
  const next = $("nextPageBtn");
  const pageButtons = [$("pageOneBtn"), $("pageTwoBtn"), $("pageThreeBtn")];

  if (state.page > totalPages) state.page = totalPages;

  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= totalPages;

  const firstPage = Math.max(1, Math.min(state.page - 1, Math.max(1, totalPages - 2)));

  pageButtons.forEach((button, index) => {
    if (!button) return;

    const pageNumber = firstPage + index;

    button.textContent = String(pageNumber);
    button.disabled = pageNumber > totalPages;
    button.classList.toggle("active", state.page === pageNumber);
    button.dataset.page = String(pageNumber);
  });
}

/* ATTACHMENTS */

function fileExtension(file) {
  const name = file.name || "";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return ext || "file";
}

function contentTypeForExtension(extension) {
  const clean = String(extension || "").toLowerCase();

  if (clean === "jpg" || clean === "jpeg") return "image/jpeg";
  if (clean === "png") return "image/png";
  if (clean === "pdf") return "application/pdf";

  return "application/octet-stream";
}

function validateFile(file) {
  const extension = fileExtension(file);
  const allowed = ["pdf", "jpg", "jpeg", "png"];

  if (!allowed.includes(extension)) {
    throw new Error(`${file.name} is not allowed. Use PDF, JPG, JPEG, or PNG.`);
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`${file.name} is above 5 MB.`);
  }
}

function renderAttachmentList() {
  const container = $("attachmentList");
  if (!container) return;

  if (!state.attachments.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = state.attachments.map((file, index) => {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

    return `
      <div class="attachment-item">
        <span>
          <i class="fa-solid fa-paperclip"></i>
          ${escapeHtml(file.name)}
          <small>${escapeHtml(fileExtension(file).toUpperCase())} • ${sizeMb} MB</small>
        </span>

        <button type="button" data-remove-attachment="${index}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
  }).join("");
}

async function uploadAnnouncementFiles(announcementId) {
  const uploaded = [];

  for (const file of state.attachments) {
    const extension = fileExtension(file);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `announcement_attachments/${announcementId}/${Date.now()}_${safeName}`;
    const ref = storageRef(storage, path);

    await uploadBytes(ref, file, {
      contentType: contentTypeForExtension(extension)
    });

    const url = await getDownloadURL(ref);

    uploaded.push({
      name: file.name,
      size: file.size,
      extension,
      url
    });
  }

  return uploaded;
}

/* PUBLISH / DELETE */

async function publishAnnouncement() {
  const title = $("announcementTitle")?.value.trim() || "";
  const message = $("announcementMessage")?.value.trim() || "";
  const propertyId = $("propertySelect")?.value || "";

  if (!title) {
    showToast("Please enter announcement title.", "error");
    return;
  }

  if (!propertyId) {
    showToast("Please select property location.", "error");
    return;
  }

  if (!message) {
    showToast("Please enter announcement message.", "error");
    return;
  }

  if (state.loading) return;

  const property = getPropertyById(propertyId) || {
    id: propertyId,
    propertyName: getPropertyNameFromSession(),
    address: getPropertyNameFromSession()
  };

  const publishBtn = $("publishBtn");
  state.loading = true;

  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Publishing...`;
  }

  try {
    const docRef = doc(collection(db, COLLECTIONS.announcements));
    const attachments = await uploadAnnouncementFiles(docRef.id);

    const payload = {
      title,
      message,
      description: message,
      priority: state.activePriority,
      propertyId: property.id || propertyId,
      propertyName: propertyName(property),
      propertyLocation: propertyLabel(property),
      propertyAddress: propertyAddress(property),
      visibleTo: "residents",
      status: "Published",
      announcementStatus: "Published",
      attachments,
      attachmentUrls: attachments.map((item) => item.url),
      createdByStaffId: session.uid,
      createdByStaffEmail: session.email,
      createdByName: getStaffName(),
      publishedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);

    batch.set(docRef, payload);

    const eventPayload = announcementEventPayload({
      action: "announcement_published",
      title: "Announcement Published",
      message: `${title} published for ${propertyLabel(property)}.`,
      announcementId: docRef.id,
      announcementTitle: title,
      propertyId: property.id || propertyId,
      propertyName: propertyName(property),
      priority: state.activePriority
    });

    batch.set(doc(collection(db, COLLECTIONS.notifications)), eventPayload);
    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      ...eventPayload,
      read: true,
      isRead: true,
      logType: "announcement_activity"
    });

    await batch.commit();

    showToast("Announcement published successfully.");
    clearForm();
  } catch (error) {
    console.error("Publish announcement failed:", error);
    showToast(`Publish failed: ${error.message}`, "error");
  } finally {
    state.loading = false;

    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.innerHTML = `<i class="fa-regular fa-paper-plane"></i> Publish Announcement`;
    }
  }
}

async function deleteAnnouncement(id) {
  const record = state.announcements.find((item) => item.id === id);

  if (!record) {
    showToast("Announcement not found.", "error");
    return;
  }

  const confirmed = confirm("Delete this announcement? It will be removed from the resident app.");
  if (!confirmed) return;

  try {
    const title = announcementTitle(record);
    const priority = priorityClean(record.priority);

    const batch = writeBatch(db);

    batch.delete(doc(db, COLLECTIONS.announcements, id));

    const eventPayload = announcementEventPayload({
      action: "announcement_deleted",
      title: "Announcement Deleted",
      message: `${title} was deleted.`,
      announcementId: id,
      announcementTitle: title,
      propertyId: firstText([record.propertyId, record.property_id], ""),
      propertyName: firstText([record.propertyName, record.propertyLocation, record.property], ""),
      priority
    });

    batch.set(doc(collection(db, COLLECTIONS.notifications)), eventPayload);
    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      ...eventPayload,
      read: true,
      isRead: true,
      logType: "announcement_activity"
    });

    await batch.commit();

    closeModal("announcementDetailsModal");
    showToast("Announcement deleted.");
  } catch (error) {
    console.error("Delete announcement failed:", error);
    showToast(`Delete failed: ${error.message}`, "error");
  }
}

function announcementEventPayload({
  action,
  title,
  message,
  announcementId = "",
  announcementTitle = "",
  propertyId = "",
  propertyName = "",
  priority = ""
}) {
  const now = serverTimestamp();

  return {
    module: "announcements",
    type: "announcement_action",
    action,
    title,
    message,
    announcementId,
    announcementTitle,
    propertyId,
    propertyName,
    priority,
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
}

/* DETAILS */

function showAnnouncementDetails(id) {
  const item = state.announcements.find((announcement) => announcement.id === id);

  if (!item) {
    showToast("Announcement not found.", "error");
    return;
  }

  state.selectedAnnouncementId = id;

  const priority = priorityClean(item.priority);
  const priorityCss = priorityClass(priority);
  const date = announcementDate(item);
  const attachments = announcementAttachments(item);
  const propertyDisplay = firstText([
    item.propertyName,
    item.propertyLocation,
    item.property,
    "All Properties"
  ], "All Properties");

  const body = $("announcementDetailsBody");
  if (!body) return;

  body.innerHTML = `
    <div class="details-title-row">
      <div class="announcement-icon ${priorityCss}">
        <i class="${escapeHtml(iconForAnnouncement(item))}"></i>
      </div>

      <div>
        <span class="priority-badge ${priorityCss}">${escapeHtml(priority)}</span>
        <h3>${escapeHtml(announcementTitle(item))}</h3>
      </div>
    </div>

    <div class="details-grid">
      <div class="details-row">
        <span>Property</span>
        <strong>${escapeHtml(propertyDisplay)}</strong>
      </div>

      <div class="details-row">
        <span>Date</span>
        <strong>${escapeHtml(formatDate(date))}</strong>
      </div>

      <div class="details-row">
        <span>Time</span>
        <strong>${escapeHtml(formatTime(date))}</strong>
      </div>

      <div class="details-row">
        <span>Created By</span>
        <strong>${escapeHtml(firstText([item.createdByName, item.staffName, item.authorName], "Staff"))}</strong>
      </div>
    </div>

    <div class="details-message">${escapeHtml(announcementMessage(item))}</div>

    <div class="details-attachments">
      <h4>Attachments</h4>

      ${
        attachments.length
          ? attachments.map((attachment) => `
              <a class="attachment-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener">
                <i class="fa-solid fa-paperclip"></i>
                <span>${escapeHtml(attachment.name)}</span>
              </a>
            `).join("")
          : `<div class="empty-box">No attachments.</div>`
      }
    </div>

    <button type="button" class="delete-announcement-btn" id="deleteAnnouncementBtn">
      <i class="fa-regular fa-trash-can"></i>
      Delete Announcement
    </button>
  `;

  $("deleteAnnouncementBtn")?.addEventListener("click", () => deleteAnnouncement(id));

  openModal("announcementDetailsModal");
}

/* NOTIFICATIONS */

function isAnnouncementNotification(item) {
  const module = normalize(item.module);
  const type = normalize(item.type || item.notificationType);
  const text = [
    item.action,
    item.event,
    item.title,
    item.subject,
    item.message,
    item.description,
    item.body
  ].join(" ").toLowerCase();

  return (
    module === "announcements" ||
    module === "announcement" ||
    type === "announcement_action" ||
    text.includes("announcement") ||
    text.includes("published")
  );
}

function titleFromAnnouncementAction(action) {
  const clean = normalize(action);

  if (clean.includes("delete")) return "Announcement Deleted";
  if (clean.includes("publish") || clean.includes("created")) return "Announcement Published";
  if (clean.includes("update")) return "Announcement Updated";

  return "Announcement Activity";
}

function notificationIcon(action) {
  const clean = normalize(action);

  if (clean.includes("delete")) return "fa-regular fa-trash-can";
  if (clean.includes("publish") || clean.includes("created")) return "fa-solid fa-bullhorn";
  if (clean.includes("update")) return "fa-regular fa-pen-to-square";

  return "fa-regular fa-bell";
}

function notificationColor(action, priority) {
  const clean = normalize(action);

  if (clean.includes("delete")) return COLORS.red;

  const p = priorityClean(priority);
  if (p === "High") return COLORS.red;
  if (p === "Low") return COLORS.green;

  return COLORS.orange;
}

function rawNotifications() {
  const records = [
    ...state.notifications.map((item) => ({ ...item, collection: COLLECTIONS.notifications })),
    ...state.activityLogs.map((item) => ({ ...item, collection: COLLECTIONS.activityLogs }))
  ];

  return records
    .filter(isAnnouncementNotification)
    .map((item) => {
      const action = firstText([item.action, item.event, item.type], "announcement_activity");
      const createdAt = toDate(item.createdAt || item.updatedAt || item.publishedAt) || new Date();

      return {
        readKey: `announcement_notification_${item.collection}_${item.id}`,
        title: firstText([item.title, item.subject], titleFromAnnouncementAction(action)),
        message: firstText([
          item.message,
          item.description,
          item.body,
          item.announcementTitle
        ], "Announcement activity updated."),
        propertyName: firstText([item.propertyName, item.property], ""),
        priority: firstText([item.priority], ""),
        action,
        createdAt,
        read: item.read === true || item.isRead === true
      };
    })
    .sort((a, b) => {
      return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
    })
    .slice(0, 80);
}

function visibleNotifications() {
  return rawNotifications().filter((item) => {
    return !item.read && !state.readNotificationKeys.has(item.readKey);
  });
}

function renderNotifications() {
  const notifications = visibleNotifications();

  setText("notificationCount", notifications.length > 99 ? "99+" : notifications.length);

  const list = $("notificationList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<div class="empty-box">No unread announcement notifications.</div>`;
    return;
  }

  list.innerHTML = notifications.slice(0, 40).map((item) => {
    const color = notificationColor(item.action, item.priority);

    return `
      <div class="notification-item">
        <div class="notification-item-icon" style="color:${color};background:${color}18;">
          <i class="${escapeHtml(notificationIcon(item.action))}"></i>
        </div>

        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
          ${item.propertyName ? `<p>Property: ${escapeHtml(item.propertyName)}</p>` : ""}
          ${item.priority ? `<p>Priority: ${escapeHtml(item.priority)}</p>` : ""}
          <small>${escapeHtml(timeAgo(item.createdAt))}</small>
        </div>
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

/* FORM */

function clearForm() {
  $("announcementForm")?.reset();

  state.activePriority = "High";
  state.attachments = [];

  document.querySelectorAll(".priority-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.priority === "High");
  });

  setText("messageCount", "0");
  renderAttachmentList();
  renderPropertySelect();
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

      if (stateKey === "properties") {
        renderPropertySelect();
      }

      renderAnnouncements();
      renderNotifications();
    },
    (error) => {
      console.error(`${collectionName} fetch failed:`, error);
      state[stateKey] = [];

      if (stateKey === "properties") {
        renderPropertySelect();
      }

      renderAnnouncements();
      renderNotifications();
      showToast(`${collectionName} fetch failed. Check Firestore rules.`, "error");
    }
  );
}

function subscribeCollections() {
  if (subscriptionsStarted) return;
  subscriptionsStarted = true;

  subscribeCollection("properties", COLLECTIONS.properties);
  subscribeCollection("announcements", COLLECTIONS.announcements);
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

function setupFormEvents() {
  document.querySelectorAll(".priority-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePriority = button.dataset.priority || "Medium";

      document.querySelectorAll(".priority-btn").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
    });
  });

  $("announcementMessage")?.addEventListener("input", (event) => {
    setText("messageCount", String(event.target.value.length));
  });

  $("attachmentInput")?.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);

    for (const file of files) {
      try {
        if (state.attachments.length >= 5) {
          throw new Error("You can upload up to 5 files.");
        }

        validateFile(file);
        state.attachments.push(file);
      } catch (error) {
        showToast(error.message || "Attachment failed.", "error");
      }
    }

    renderAttachmentList();
    event.target.value = "";
  });

  $("announcementForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await publishAnnouncement();
  });

  $("clearBtn")?.addEventListener("click", clearForm);
}

function setupListEvents() {
  $("announcementFilter")?.addEventListener("change", (event) => {
    state.filter = event.target.value || "All Announcements";
    state.page = 1;
    renderAnnouncements();
  });

  $("refreshBtn")?.addEventListener("click", () => {
    renderAnnouncements();
    showToast("Announcements refreshed.");
  });

  $("prevPageBtn")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderAnnouncements();
    }
  });

  $("nextPageBtn")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(filteredAnnouncements().length / state.pageSize));

    if (state.page < totalPages) {
      state.page += 1;
      renderAnnouncements();
    }
  });

  ["pageOneBtn", "pageTwoBtn", "pageThreeBtn"].forEach((id) => {
    $(id)?.addEventListener("click", (event) => {
      const page = Number(event.currentTarget.dataset.page || event.currentTarget.textContent || 1);
      const totalPages = Math.max(1, Math.ceil(filteredAnnouncements().length / state.pageSize));

      if (page >= 1 && page <= totalPages) {
        state.page = page;
        renderAnnouncements();
      }
    });
  });
}

function setupEvents() {
  setupFormEvents();
  setupListEvents();

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

  document.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-attachment]");
    if (removeButton) {
      const index = Number(removeButton.dataset.removeAttachment);

      if (Number.isFinite(index)) {
        state.attachments.splice(index, 1);
        renderAttachmentList();
      }

      return;
    }

    const moreButton = event.target.closest("[data-announcement-id]");
    if (moreButton) {
      showAnnouncementDetails(moreButton.dataset.announcementId);
    }
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupClock();
  setupLayout();
  setupEvents();
  setupAuth();
});