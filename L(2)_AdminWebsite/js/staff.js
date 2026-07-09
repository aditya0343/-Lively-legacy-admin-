import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await signOut(auth);
    window.location.href = "../index.html";
    return;
  }

  const userData = userSnap.data();

  if (userData.role !== "staff" || userData.status !== "active") {
    await signOut(auth);
    window.location.href = "../index.html";
    return;
  }

  const staffName = document.getElementById("staffName");
  if (staffName) {
    staffName.textContent = userData.name || "Staff";
  }
});

const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.clear();
    window.location.href = "../index.html";
  });
}