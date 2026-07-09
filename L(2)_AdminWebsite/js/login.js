import { auth, db } from "./firebase-config.js";

import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let selectedRole = "admin";

const roleSelected = document.getElementById("roleSelected");
const roleMenu = document.getElementById("roleMenu");
const selectedRoleText = document.getElementById("selectedRoleText");
const roleOptions = document.querySelectorAll(".role-option");

const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const errorBox = document.getElementById("errorBox");

function cleanValue(value) {
  return String(value || "")
    .trim()
    .replaceAll('"', "")
    .replaceAll("'", "")
    .toLowerCase();
}

function getFieldValue(data, fieldName) {
  const matchedKey = Object.keys(data).find(
    (key) => key.trim().toLowerCase() === fieldName.toLowerCase()
  );

  if (!matchedKey) {
    return "";
  }

  return cleanValue(data[matchedKey]);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

function hideError() {
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

/* ROLE DROPDOWN */

roleSelected.addEventListener("click", () => {
  roleMenu.classList.toggle("open");
});

roleOptions.forEach((option) => {
  option.addEventListener("click", () => {
    selectedRole = option.dataset.role;

    selectedRoleText.textContent = selectedRole === "admin" ? "Admin" : "Staff";

    roleOptions.forEach((item) => {
      item.classList.remove("active");
      item.querySelector(".fa-check").classList.add("check-hidden");
    });

    option.classList.add("active");
    option.querySelector(".fa-check").classList.remove("check-hidden");

    roleMenu.classList.remove("open");
  });
});

document.addEventListener("click", (e) => {
  if (!roleSelected.contains(e.target) && !roleMenu.contains(e.target)) {
    roleMenu.classList.remove("open");
  }
});

/* PASSWORD SHOW/HIDE */

togglePassword.addEventListener("click", () => {
  const icon = togglePassword.querySelector("i");

  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    passwordInput.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
});

/* FIREBASE LOGIN */

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  hideError();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  loginBtn.disabled = true;
  loginBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Logging in...`;

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const user = userCredential.user;

    console.log("Logged in UID:", user.uid);

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showError("User profile not found in database.");
      return;
    }

    const userData = userSnap.data();

    console.log("Firestore user data:", userData);
    console.log("Firestore field names:", Object.keys(userData));

    const firestoreRole = getFieldValue(userData, "role");
    const firestoreStatus = getFieldValue(userData, "status");
    const selectedLoginRole = cleanValue(selectedRole);

    console.log("Firestore role:", firestoreRole);
    console.log("Firestore status:", firestoreStatus);
    console.log("Selected login role:", selectedLoginRole);

    if (firestoreStatus !== "active") {
      showError(`Your account is inactive. Firestore status is: ${firestoreStatus}`);
      return;
    }

    if (firestoreRole !== selectedLoginRole) {
      showError(
        `You are not allowed to login as ${selectedLoginRole}. Your role is ${firestoreRole}.`
      );
      return;
    }

   localStorage.setItem("loginType", firestoreRole);
localStorage.setItem("loggedInUserRole", firestoreRole);
localStorage.setItem("loggedInUserName", userData.name || userData.staffName || "");
localStorage.setItem("loggedInUserEmail", userData.email || email);
localStorage.setItem("loggedInUserUID", user.uid);

if (firestoreRole === "staff") {
  localStorage.setItem("staffAccountId", user.uid);
  localStorage.setItem("loggedInStaffId", userData.staffId || user.uid);
  localStorage.setItem("staffName", userData.name || userData.staffName || "Staff");
  localStorage.setItem("staffRole", "staff");
  localStorage.setItem("staffDepartment", userData.department || "");
  localStorage.setItem("staffPropertyId", userData.propertyId || userData.assignedPropertyId || "");
  localStorage.setItem("staffStatus", userData.status || "active");
}
    if (firestoreRole === "admin") {
      window.location.href = "admin/admin-home.html";
    } else if (firestoreRole === "staff") {
      window.location.href = "staff/staff-dashboard.html";
    } else {
      showError("Invalid user role.");
    }
  } catch (error) {
    console.log("Firebase login error:", error.code, error.message);

    if (error.code === "auth/invalid-credential") {
      showError("Invalid email or password.");
    } else if (error.code === "auth/user-not-found") {
      showError("User not found.");
    } else if (error.code === "auth/wrong-password") {
      showError("Wrong password.");
    } else if (error.code === "auth/operation-not-allowed") {
      showError("Email/password login is not enabled in Firebase.");
    } else if (error.code === "permission-denied") {
      showError("Firestore permission denied. Check Firebase rules.");
    } else {
      showError(error.message);
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Login`;
  }
});
