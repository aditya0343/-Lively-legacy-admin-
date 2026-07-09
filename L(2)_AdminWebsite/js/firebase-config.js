import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYrOPrFkkJptGO73N_vsqqwtcFgQQpaS4",
  authDomain: "lively-legacy-ecosystem.firebaseapp.com",
  projectId: "lively-legacy-ecosystem",
  storageBucket: "lively-legacy-ecosystem.firebasestorage.app",
  messagingSenderId: "1021847586984",
  appId: "1:1021847586984:web:a994569580ecfe5fb21a9d"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);