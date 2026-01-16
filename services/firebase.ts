import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAp66hKd3-HY4AaC4bB1zhMIbh-7ZC2X6k",
  authDomain: "preisvergleich-1f383.firebaseapp.com",
  projectId: "preisvergleich-1f383",
  storageBucket: "preisvergleich-1f383.firebasestorage.app",
  messagingSenderId: "710299848020",
  appId: "1:710299848020:web:dcb11de266a1f3f79d0cc1",
  measurementId: "G-0XNRG4X3LR"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Auth Export-Hilfen
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged };

/**
 * Abonniert ein Dokument im privaten Bereich des Nutzers.
 * Pfad: users/{uid}/data/{documentId}
 */
export const syncUserCollection = (userId: string, documentId: string, callback: (data: any) => void) => {
  return onSnapshot(doc(db, "users", userId, "data", documentId), (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data().value);
    } else {
      callback(null);
    }
  });
};

/**
 * Aktualisiert ein Dokument im privaten Bereich des Nutzers.
 */
export const updateUserFirestore = async (userId: string, documentId: string, value: any) => {
  try {
    await setDoc(doc(db, "users", userId, "data", documentId), { 
      value,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    console.error("Fehler beim Speichern in Firestore: ", e);
    throw e;
  }
};
