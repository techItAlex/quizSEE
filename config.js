// Fill in the placeholders (see HUMAN_SETUP.md). Loaded as an ES module.
export const CONFIG = {
  FIREBASE_API_KEY: "YOUR_FIREBASE_API_KEY",
  FIREBASE_PROJECT_ID: "YOUR_FIREBASE_PROJECT_ID",
  GOOGLE_OAUTH_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  TEACHER_EMAILS: ["alexandercuison07@gmail.com"], // also edit firestore.rules
};
export const isConfigured = () => !Object.values(CONFIG).some(v => typeof v === "string" && v.startsWith("YOUR_"));
