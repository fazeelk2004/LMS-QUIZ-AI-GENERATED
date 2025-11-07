// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import OpenAI from "openai";
import dotenv from "dotenv";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- helpers ---------- */
function getExtSafe(name = "") {
  return path.extname(name).toLowerCase();
}

function buildPdfParseOptions() {
  const pagerender = (pageData) => {
    const opts = { normalizeWhitespace: true, disableCombineTextItems: false };
    return pageData.getTextContent(opts).then((tc) => {
      let lastY = null;
      let text = "";
      for (const it of tc.items) {
        const y = it.transform?.[5];
        text += lastY === y || lastY === null ? it.str : "\n" + it.str;
        lastY = y;
      }
      return text + "\n";
    });
  };
  return { pagerender, max: 25 * 1024 * 1024, version: "default" };
}

async function extractTextFromPptx(filePath) {
  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((p) => p.startsWith("ppt/slides/slide") && p.endsWith(".xml"))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || "0", 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || "0", 10);
      return na - nb;
    });

  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false });
  const parts = [];
  function collectAText(node) {
    if (node == null) return;
    if (Array.isArray(node)) return node.forEach(collectAText);
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k.endsWith(":t") && typeof v === "string") parts.push(v);
        else collectAText(v);
      }
    }
  }
  for (const p of slideFiles) {
    const xml = await zip.files[p].async("string");
    const json = parser.parse(xml);
    collectAText(json);
    parts.push("\n");
  }
  return parts.join(" ").replace(/\s*\n\s*/g, "\n").trim();
}

async function extractText(filePath, mimetype, originalname) {
  const ext = getExtSafe(originalname);
  const isPDF = mimetype === "application/pdf" || ext === ".pdf" || mimetype === "application/octet-stream";
  const isDOCX =
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx";
  const isPPTX =
    mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || ext === ".pptx";
  const isTXT = mimetype?.startsWith("text/") || ext === ".txt";

  if (isPDF) {
    const buf = await fs.readFile(filePath);
    const data = await pdfParse(buf, buildPdfParseOptions());
    return (data.text || "").trim();
  }
  if (isDOCX) {
    const res = await mammoth.extractRawText({ path: filePath });
    return (res.value || "").trim();
  }
  if (isPPTX) {
    const txt = await extractTextFromPptx(filePath);
    return (txt || "").trim();
  }
  if (isTXT) return (await fs.readFile(filePath, "utf8")).trim();

  throw new Error("Unsupported file type. Please upload PDF, DOCX, PPTX, or TXT.");
}

/* ---------- main route ---------- */
app.post("/api/generate-quiz", upload.single("file"), async (req, res) => {
  let tempPath;
  try {
    const { file } = req;
    if (!file) return res.status(400).json({ error: "No file uploaded." });

    tempPath = file.path;

    const questionCount = Math.max(1, Math.min(20, parseInt(req.body.questionCount, 10) || 5));
    const diffRaw = String(req.body.difficulty || "mixed").toLowerCase();
    const allowedDiff = new Set(["easy", "medium", "hard", "mixed"]);
    const difficulty = allowedDiff.has(diffRaw) ? diffRaw : "mixed";

    // NEW: mode can be 'mcq' or 'short'
    const modeRaw = String(req.body.mode || "mcq").toLowerCase();
    const mode = modeRaw === "short" ? "short" : "mcq";

    const text = await extractText(tempPath, file.mimetype, file.originalname);
    if (!text || text.length < 50)
      return res.status(422).json({
        error: "Text extraction failed (too little text or image-only without OCR).",
      });

    // --- build schema + prompt based on mode ---
    let schema, name, prompt;
    if (mode === "mcq") {
      name = "mcq_list";
      schema = {
        type: "object",
        additionalProperties: false,
        required: ["quiz"],
        properties: {
          quiz: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["question", "options", "answer", "difficulty"],
              properties: {
                question: { type: "string" },
                options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                answer: { type: "string" },
                difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              },
            },
          },
        },
      };

      prompt = `
You are an expert teaching assistant.

Task:
- From the provided text, create ${questionCount} multiple-choice questions (MCQs).
- Each MCQ must have exactly 4 options and 1 correct answer that appears verbatim in the options.
- Tag each MCQ with difficulty: "easy", "medium", or "hard".
- Difficulty mode selected by user: "${difficulty}".
  - If "mixed": distribute evenly across all 3 levels.
  - If "easy" | "medium" | "hard": make all questions at that level.

Return ONLY valid JSON in this shape:
{ "quiz": [ { "question": "...", "options": ["A","B","C","D"], "answer": "A", "difficulty": "easy|medium|hard" } ] }

Text:
"""${text.slice(0, 40000)}"""`;
    } else {
      name = "shortqa_list";
      schema = {
        type: "object",
        additionalProperties: false,
        required: ["quiz"],
        properties: {
          quiz: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["question", "answer", "difficulty"],
              properties: {
                question: { type: "string" },
                answer: { type: "string" },
                difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              },
            },
          },
        },
      };

      prompt = `
You are an expert teaching assistant.

Task:
- Read the PDF, PPTX, DOCX, or TXT content provided thoroughly.
- From the provided text, create ${questionCount} short-answer questions (NOT MCQs).
- Each question should have a concise answer (1-2 sentences).
- Each item should include a difficulty tag: "easy", "medium", or "hard".
- Difficulty mode selected by user: "${difficulty}".
  - If "mixed": distribute evenly across all 3 levels.
  - If "easy" | "medium" | "hard": make all questions at that level.

Return ONLY valid JSON in this shape:
{ "quiz": [ { "question": "...", "difficulty": "easy|medium|hard" } ] }

Text:
"""${text.slice(0, 40000)}"""`;
    }

    const completion = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
      text: { format: { type: "json_schema", name, schema } },
    });

    const outText = completion.output?.[0]?.content?.[0]?.text ?? completion.output_text ?? "{}";
    const parsed = JSON.parse(outText);
    const quiz = Array.isArray(parsed.quiz) ? parsed.quiz : [];

    res.json({ quiz, type: mode });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch {}
    }
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
