// server.js
// PDFLord — Word to PDF conversion backend
// Converts .docx files to PDF using headless LibreOffice (soffice),
// which gives Word-accurate rendering of shapes, text boxes, SmartArt,
// tables, embedded fonts, etc. — things browser-side reconstruction can't do.

const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- Config ----------
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES_PER_REQUEST = 5;
const CONVERSION_TIMEOUT_MS = 60_000; // 60s per file — LibreOffice can be slow to spin up
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// ---------- CORS (lock this down to your actual domain in production) ----------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://www.pdflord.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Upload handling ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: MAX_FILES_PER_REQUEST,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.docx' || !ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only .docx files are accepted.'));
    }
    cb(null, true);
  },
});

// ---------- Core conversion ----------
async function convertDocxBufferToPdf(buffer, originalName) {
  const jobId = crypto.randomUUID();
  const workDir = path.join(os.tmpdir(), `pdflord-${jobId}`);
  await fs.mkdir(workDir, { recursive: true });

  const safeBaseName = 'input'; // never trust the original filename for paths on disk
  const inputPath = path.join(workDir, `${safeBaseName}.docx`);
  const expectedOutputPath = path.join(workDir, `${safeBaseName}.pdf`);

  try {
    await fs.writeFile(inputPath, buffer);

    // --convert-to pdf runs LibreOffice's real layout/rendering engine.
    // -env:UserInstallation points each job at its own throwaway profile dir
    // so concurrent conversions don't corrupt a shared LibreOffice profile.
    const userInstall = `-env:UserInstallation=file://${workDir}/lo_profile`;

    await execFileAsync(
      'soffice',
      [
        '--headless',
        '--norestore',
        userInstall,
        '--convert-to', 'pdf',
        '--outdir', workDir,
        inputPath,
      ],
      { timeout: CONVERSION_TIMEOUT_MS }
    );

    const pdfBuffer = await fs.readFile(expectedOutputPath);
    return pdfBuffer;
  } finally {
    // Always clean up temp files — never leave uploaded content on disk
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Routes ----------

// Single file conversion
app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const pdfBuffer = await convertDocxBufferToPdf(req.file.buffer, req.file.originalname);
    const outName = req.file.originalname.replace(/\.docx$/i, '') + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Conversion failed:', err);
    res.status(500).json({ error: 'Conversion failed. The file may be corrupted or use unsupported features.' });
  }
});

// Batch conversion — returns a JSON manifest + base64 PDFs
// (Simpler for the frontend to zip client-side, matching your existing ZIP flow)
app.post('/api/convert-batch', upload.array('files', MAX_FILES_PER_REQUEST), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const results = [];
  for (const file of req.files) {
    try {
      const pdfBuffer = await convertDocxBufferToPdf(file.buffer, file.originalname);
      results.push({
        originalName: file.originalname,
        outputName: file.originalname.replace(/\.docx$/i, '') + '.pdf',
        status: 'done',
        base64: pdfBuffer.toString('base64'),
      });
    } catch (err) {
      console.error(`Conversion failed for ${file.originalname}:`, err);
      results.push({
        originalName: file.originalname,
        status: 'error',
        error: 'Conversion failed.',
      });
    }
  }

  res.json({ results });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('.docx')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`PDFLord conversion backend listening on port ${PORT}`);
});
