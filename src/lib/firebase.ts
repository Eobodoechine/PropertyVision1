import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyB1mnnbOUNVKRw20eWnGAUQyRQYL8bvvFQ",
  authDomain: "agile-device-472202-i8.firebaseapp.com",
  projectId: "agile-device-472202-i8",
  storageBucket: "agile-device-472202-i8.firebasestorage.app",
  messagingSenderId: "839845580521",
  appId: "1:839845580521:web:401cb321f90f0b94ee6a78",
  measurementId: "G-0JXCSDV1PR"
};

// Only initialize Firebase if auth is not disabled
const disableAuth = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true';

const app = disableAuth ? undefined : initializeApp(firebaseConfig);
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// Initialize analytics only in browser environment
let analytics: any = null;
if (typeof window !== 'undefined' && app) {
  analytics = getAnalytics(app);
}

export { analytics };
export default app;