const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// init db
const db = new sqlite3.Database("./compre.db");

// make sure tables exist (you already ran these in DB Browser, but it’s safe)
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    author TEXT,
    content TEXT,
    isPublic INTEGER DEFAULT 1,
    createdAt TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noteId INTEGER,
    author TEXT,
    content TEXT,
    createdAt TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    originalName TEXT,
    filePath TEXT,
    uploader TEXT,
    uploadedAt TEXT
  )
`);

// ---- MULTER (for uploads) ----
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "uploads");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    // keep original name or give unique
    const unique = Date.now() + "-" + file.originalname;
    cb(null, unique);
  },
});
const upload = multer({ storage });

// ----------------------------------
// NOTES
// ----------------------------------
app.get("/notes", (req, res) => {
  const { subject } = req.query;
  if (!subject) return res.json([]);

  db.all(
    "SELECT * FROM notes WHERE subject = ? ORDER BY createdAt DESC",
    [subject],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // for each note, load comments
      const notes = [];
      let pending = rows.length;
      if (pending === 0) return res.json([]);

      rows.forEach((row) => {
        db.all(
          "SELECT * FROM comments WHERE noteId = ? ORDER BY createdAt ASC",
          [row.id],
          (err2, crows) => {
            notes.push({
              id: row.id,
              subject: row.subject,
              author: row.author,
              content: row.content,
              isPublic: row.isPublic === 1,
              createdAt: row.createdAt,
              comments: crows || [],
            });
            pending--;
            if (pending === 0) {
              // sort again just in case
              notes.sort(
                (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
              );
              res.json(notes);
            }
          }
        );
      });
    }
  );
});

app.post("/notes", (req, res) => {
  const { subject, author, content, isPublic } = req.body;
  if (!subject || !author || !content) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO notes (subject, author, content, isPublic, createdAt) VALUES (?,?,?,?,?)",
    [subject, author, content, isPublic ? 1 : 0, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      return res.json({
        id: this.lastID,
        subject,
        author,
        content,
        isPublic: !!isPublic,
        createdAt,
      });
    }
  );
});

app.delete("/notes/:id", (req, res) => {
  const noteId = req.params.id;
  db.run("DELETE FROM notes WHERE id = ?", [noteId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    // also delete comments for this note
    db.run("DELETE FROM comments WHERE noteId = ?", [noteId]);
    return res.json({ success: true });
  });
});

app.post("/notes/:id/comments", (req, res) => {
  const noteId = req.params.id;
  const { author, content } = req.body;
  if (!author || !content) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO comments (noteId, author, content, createdAt) VALUES (?,?,?,?)",
    [noteId, author, content, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      return res.json({
        id: this.lastID,
        noteId,
        author,
        content,
        createdAt,
      });
    }
  );
});

// ----------------------------------
// FILES
// ----------------------------------

// list files for a subject
app.get("/files", (req, res) => {
  const { subject } = req.query;
  if (!subject) return res.json([]);
  db.all(
    "SELECT * FROM files WHERE subject = ? ORDER BY uploadedAt DESC",
    [subject],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// upload file
app.post("/upload", upload.single("file"), (req, res) => {
  const { subject, uploader } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: "No file" });
  }
  const originalName = req.file.originalname;
  const filePath = "/uploads/" + req.file.filename;
  const uploadedAt = new Date().toISOString();

  db.run(
    "INSERT INTO files (subject, originalName, filePath, uploader, uploadedAt) VALUES (?,?,?,?,?)",
    [subject, originalName, filePath, uploader || "Unknown", uploadedAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        subject,
        originalName,
        filePath,
        uploader: uploader || "Unknown",
        uploadedAt,
      });
    }
  );
});

// ✅ DELETE file (this is the one you were missing)
app.delete("/files/:id", (req, res) => {
  const fileId = req.params.id;
  const user = req.query.user || ""; // frontend sends ?user=...

  // get file first
  db.get("SELECT * FROM files WHERE id = ?", [fileId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "File not found" });

    // check ownership
    if (row.uploader !== user && user !== "admin") {
      return res.status(403).json({ error: "Not allowed to delete this file" });
    }

    // delete from db
    db.run("DELETE FROM files WHERE id = ?", [fileId], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });

      // optional: delete physical file
      const fullPath = path.join(__dirname, row.filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (e) => {
          // ignore error
        });
      }

      return res.json({ success: true });
    });
  });
});



// basic root
app.get("/", (req, res) => {
  res.send("Backend is running successfully!");
});

// 👇 change this part
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});



