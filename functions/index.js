const functions = require("firebase-functions");
const express = require("express");
const app = express();

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/events", (req, res) => {
  res.json({ items: [] }); // placeholder
});

// ✅ Export the function for Firebase to see it
exports.api = functions.https.onRequest(app);
