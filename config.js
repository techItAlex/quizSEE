// Fill in the placeholders (see HUMAN_SETUP.md). Loaded as an ES module.
export const CONFIG = {
  FIREBASE_API_KEY: "AIzaSyCg7pgeBweQBJQumHA8SkvzOrtJhiZFcMg",
  FIREBASE_PROJECT_ID: "quizsee-db244",
  GOOGLE_OAUTH_CLIENT_ID: "2930619650-4af437137qbhhgr5i5jbfqt2vvoj555h.apps.googleusercontent.com",
  TEACHER_EMAILS: ["alexandercuison07@gmail.com"], // also edit firestore.rules
};
export const isConfigured = () => !Object.values(CONFIG).some(v => typeof v === "string" && v.startsWith("YOUR_"));
