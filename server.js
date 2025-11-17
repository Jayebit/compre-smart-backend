const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Initialize DB
const db = new sqlite3.Database("./compre.db");

// Create required tables
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    streak INTEGER DEFAULT 0,
    last_login TEXT
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

db.run(`
  CREATE TABLE IF NOT EXISTS reflections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    subject TEXT,
    content TEXT,
    mood TEXT,
    createdAt TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    text TEXT,
    suggested TEXT,
    createdBy TEXT,
    createdAt TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    questionId INTEGER,
    answerText TEXT,
    answeredBy TEXT,
    createdAt TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    answerId INTEGER,
    questionId INTEGER,
    isCorrect INTEGER,
    feedback TEXT,
    gradedBy TEXT,
    createdAt TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    subject TEXT,
    value INTEGER,
    updatedAt TEXT
  )
`);


// Subjects for Question Bank
app.get("/lessons", (req, res) => {
  res.json({
    firstSemester: [
      "Understanding the Self",
      "Readings in the Philippine History",
      "Mathematics in the Modern World",
      "Ethics",
      "The Life and Works of Rizal"
    ],
    secondSemester: [
      "Purposive Communication",
      "Art Appreciation",
      "Science, Technology and Society",
      "The Contemporary World"
    ]
  });
});


// Multer config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });


// ======================================================
// NOTES
// ======================================================
app.get("/notes", (req, res) => {
  const { subject } = req.query;
  if (!subject) return res.json([]);

  db.all(
    "SELECT * FROM notes WHERE subject = ? ORDER BY createdAt DESC",
    [subject],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

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
  if (!subject || !author || !content)
    return res.status(400).json({ error: "Missing fields" });

  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO notes (subject, author, content, isPublic, createdAt) VALUES (?,?,?,?,?)",
    [subject, author, content, isPublic ? 1 : 0, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
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

    db.run("DELETE FROM comments WHERE noteId = ?", [noteId]);

    res.json({ success: true });
  });
});

app.post("/notes/:id/comments", (req, res) => {
  const noteId = req.params.id;
  const { author, content } = req.body;

  if (!author || !content)
    return res.status(400).json({ error: "Missing fields" });

  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO comments (noteId, author, content, createdAt) VALUES (?,?,?,?)",
    [noteId, author, content, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      res.json({
        id: this.lastID,
        noteId,
        author,
        content,
        createdAt,
      });
    }
  );
});


// ======================================================
// FILES
// ======================================================
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

app.post("/upload", upload.single("file"), (req, res) => {
  const { subject, uploader } = req.body;
  if (!req.file) return res.status(400).json({ error: "No file" });

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

app.delete("/files/:id", (req, res) => {
  const fileId = req.params.id;
  const user = req.query.user || "";

  db.get("SELECT * FROM files WHERE id = ?", [fileId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "File not found" });

    if (row.uploader !== user && user !== "admin") {
      return res.status(403).json({ error: "Not allowed" });
    }

    db.run("DELETE FROM files WHERE id = ?", [fileId], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const fullPath = path.join(__dirname, row.filePath);
      if (fs.existsSync(fullPath)) fs.unlink(fullPath, () => {});

      res.json({ success: true });
    });
  });
});


// ======================================================
// XP SYSTEM
// ======================================================
function calculateLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

app.get("/xp", (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username required" });

  db.get(
    "SELECT username, xp, level, streak, last_login FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: "User not found" });

      res.json({
        username: user.username,
        xp: user.xp || 0,
        level: user.level || 1,
        streak: user.streak || 0,
        last_login: user.last_login,
      });
    }
  );
});

app.post("/xp/add", (req, res) => {
  const { username, amount } = req.body;

  if (!username || !amount)
    return res.status(400).json({ error: "username and amount required" });

  db.get(
    "SELECT xp FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: "User not found" });

      const newXP = (user.xp || 0) + Number(amount);
      const newLevel = calculateLevel(newXP);

      db.run(
        "UPDATE users SET xp = ?, level = ? WHERE username = ?",
        [newXP, newLevel, username],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          res.json({ username, xp: newXP, level: newLevel });
        }
      );
    }
  );
});

// ======================================================
// REFLECTIONS (FINAL VERSION)
// ======================================================

// Create reflection
app.post("/reflections", (req, res) => {
  const { username, subject, content, mood } = req.body;

  if (!username || !subject || !content)
    return res.status(400).json({ error: "Missing fields" });

  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO reflections (username, subject, content, mood, createdAt) VALUES (?,?,?,?,?)",
    [username, subject, content, mood || "", createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      db.run("UPDATE users SET xp = xp + 15 WHERE username = ?", [username]);

      res.json({
        id: this.lastID,
        success: true,
        username,
        subject,
        content,
        mood,
        createdAt,
      });
    }
  );
});

// Get reflections (only non-deleted)
app.get("/reflections", (req, res) => {
  const { username } = req.query;

  if (!username)
    return res.status(400).json({ error: "username required" });

  db.all(
   "SELECT * FROM reflections WHERE username = ? AND isDeleted = 0 ORDER BY datetime(createdAt) DESC"
    [username],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Soft delete
app.post("/reflections/delete", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing reflection id" });

  db.run(
    "UPDATE reflections SET isDeleted = 1 WHERE id = ?",
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Restore (Undo)
app.post("/reflections/restore", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing reflection id" });

  db.run(
    "UPDATE reflections SET isDeleted = 0 WHERE id = ?",
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});



// ======================================================
// QUESTIONS
// ======================================================
app.get("/questions", (req, res) => {
  const { subject } = req.query;
  const params = [];
  let sql = "SELECT * FROM questions";

  if (subject) {
    sql += " WHERE subject = ?";
    params.push(subject);
  }

  sql += " ORDER BY datetime(createdAt) DESC";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/questions", (req, res) => {
  const { subject, text, suggested, createdBy } = req.body;
  if (!subject || !text || !createdBy)
    return res.status(400).json({ error: "Missing fields" });

  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO questions (subject, text, suggested, createdBy, createdAt) VALUES (?,?,?,?,?)",
    [subject, text, suggested || "", createdBy, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      res.json({
        id: this.lastID,
        subject,
        text,
        suggested: suggested || "",
        createdBy,
        createdAt,
      });
    }
  );
});

app.delete("/questions/:id", (req, res) => {
  const qid = req.params.id;

  db.run("DELETE FROM answers WHERE questionId = ?", [qid], (err1) => {
    if (err1) return res.status(500).json({ error: err1.message });

    db.run("DELETE FROM grades WHERE questionId = ?", [qid], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.run("DELETE FROM questions WHERE id = ?", [qid], (err3) => {
        if (err3) return res.status(500).json({ error: err3.message });

        res.json({ success: true });
      });
    });
  });
});


// ======================================================
// ANSWERS
// ======================================================
app.get("/answers", (req, res) => {
  const { questionId } = req.query;

  const params = [];
  let sql = "SELECT * FROM answers";

  if (questionId) {
    sql += " WHERE questionId = ?";
    params.push(questionId);
  }

  sql += " ORDER BY datetime(createdAt) DESC";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/answers", (req, res) => {
  const { questionId, answerText, answeredBy } = req.body;

  if (!questionId || !answerText || !answeredBy)
    return res.status(400).json({ error: "Missing fields" });

  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO answers (questionId, answerText, answeredBy, createdAt) VALUES (?,?,?,?)",
    [questionId, answerText, answeredBy, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      res.json({
        id: this.lastID,
        questionId,
        answerText,
        answeredBy,
        createdAt,
      });
    }
  );
});


// ======================================================
// GRADES
// ======================================================
app.get("/grades", (req, res) => {
  const { answerId } = req.query;

  const params = [];
  let sql = "SELECT * FROM grades";

  if (answerId) {
    sql += " WHERE answerId = ?";
    params.push(answerId);
  }

  sql += " ORDER BY datetime(createdAt) DESC";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/grades", (req, res) => {
  const { answerId, questionId, isCorrect, feedback, gradedBy } = req.body;

  if (!answerId || !questionId || gradedBy == null)
    return res.status(400).json({ error: "Missing fields" });

  const createdAt = new Date().toISOString();
  const correctInt = isCorrect ? 1 : 0;

  db.run("DELETE FROM grades WHERE answerId = ?", [answerId], (errDel) => {
    if (errDel) return res.status(500).json({ error: errDel.message });

    db.run(
      "INSERT INTO grades (answerId, questionId, isCorrect, feedback, gradedBy, createdAt) VALUES (?,?,?,?,?,?)",
      [answerId, questionId, correctInt, feedback || "", gradedBy, createdAt],
      function (errIns) {
        if (errIns) return res.status(500).json({ error: errIns.message });

        res.json({
          id: this.lastID,
          answerId,
          questionId,
          isCorrect: !!correctInt,
          feedback,
          gradedBy,
          createdAt,
        });
      }
    );
  });
});


// ======================================================
// PROGRESS
// ======================================================
app.get("/progress", (req, res) => {
  const { username } = req.query;

  if (!username)
    return res.status(400).json({ error: "username is required" });

  db.all(
    "SELECT * FROM progress WHERE username = ?",
    [username],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post("/progress", (req, res) => {
  const { username, subject, value } = req.body;

  if (!username || !subject || value === undefined)
    return res.status(400).json({ error: "Missing fields" });

  const updatedAt = new Date().toISOString();

  db.get(
    "SELECT id FROM progress WHERE username = ? AND subject = ?",
    [username, subject],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row) {
        db.run(
          "UPDATE progress SET value = ?, updatedAt = ? WHERE id = ?",
          [value, updatedAt, row.id],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({
              id: row.id,
              username,
              subject,
              value,
              updatedAt,
            });
          }
        );
      } else {
        db.run(
          "INSERT INTO progress (username, subject, value, updatedAt) VALUES (?,?,?,?)",
          [username, subject, value, updatedAt],
          function (err3) {
            if (err3) return res.status(500).json({ error: err3.message });

            res.json({
              id: this.lastID,
              username,
              subject,
              value,
              updatedAt,
            });
          }
        );
      }
    }
  );
});


// ======================================================
// ROOT
// ======================================================
app.get("/", (req, res) => {
  res.send("Backend is running successfully!");
});


// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
