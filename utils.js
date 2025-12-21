import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * Checks if the given UID belongs to an admin.
 * @param {string} uid - The user's UID.
 * @returns {Promise<boolean>} - True if admin, false otherwise.
 */
export async function checkAdminStatus(uid) {
    if (!uid) return false;
    try {
        const adminDocRef = doc(db, 'admins', uid);
        const adminDocSnap = await getDoc(adminDocRef);
        return adminDocSnap.exists();
    } catch (error) {
        console.error("Error checking admin status:", error);
        return false;
    }
}
