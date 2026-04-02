'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { convertCollection } = require('./converter');

const app = express();

// Serve the single-page UI from public/
// express.static automatically serves index.html for GET /
app.use(express.static(path.join(__dirname, 'public')));
// Rate-limit the conversion endpoint: max 30 requests per minute per IP
const convertLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Multer: store uploads in memory (no temp files on disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter(_req, file, cb) {
    if (path.extname(file.originalname).toLowerCase() !== '.json') {
      return cb(Object.assign(new Error('Only JSON files are accepted.'), { status: 400 }));
    }
    cb(null, true);
  },
});

// ── Routes ───────────────────────────────────────────────────────────────

app.post('/convert', convertLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file selected.' });
  }

  let postmanData;
  try {
    postmanData = JSON.parse(req.file.buffer.toString('utf-8'));
  } catch (err) {
    return res.status(422).json({ error: `Invalid JSON: ${err.message}` });
  }

  if (!postmanData.info || !postmanData.item) {
    return res.status(422).json({
      error:
        'The uploaded file does not appear to be a Postman collection export. ' +
        'Expected top-level "info" and "item" fields.',
    });
  }

  const result = convertCollection(postmanData);
  const output = JSON.stringify([result], null, 2);

  const baseName = path.basename(req.file.originalname, '.json');
  const downloadName = `${baseName}_hoppscotch.json`;

  res.set({
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${downloadName}"`,
  });
  res.send(output);
});

// ── Multer error handler ─────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

// ── Start ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app; // export for testing
