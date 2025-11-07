// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import OpenAI from "openai";
import dotenv from "dotenv";
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

async function extractText(filePath, mimetype, originalname) {
  const ext = getExtSafe(originalname);
  const isPDF =
    mimetype === "application/pdf" ||
    ext === ".pdf" ||
    mimetype === "application/octet-stream";
  const isDOCX =
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx";
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
  if (isTXT) return (await fs.readFile(filePath, "utf8")).trim();
  throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT.");
}

/* ---------- main route ---------- */
app.post("/api/generate-quiz", upload.single("file"), async (req, res) => {
  let tempPath;
  try {
    const { file } = req;
    if (!file) return res.status(400).json({ error: "No file uploaded." });

    tempPath = file.path;
    const questionCount = Math.max(
      1,
      Math.min(20, parseInt(req.body.questionCount, 10) || 5)
    );
    const diffRaw = String(req.body.difficulty || "mixed").toLowerCase();
    const allowed = new Set(["easy", "medium", "hard", "mixed"]);
    const difficulty = allowed.has(diffRaw) ? diffRaw : "mixed";

    const text = await extractText(tempPath, file.mimetype, file.originalname);
    if (!text || text.length < 50)
      return res.status(422).json({
        error:
          "Text extraction failed (likely image-only PDF). Convert to searchable PDF and retry.",
      });

    /* ---------- schema: root object with quiz array ---------- */
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["quiz"],
      properties: {
        quiz: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,     // <-- required by the API
            required: ["question", "options", "answer", "difficulty"],
            properties: {
              question: { type: "string" },
              options: {
                type: "array",
                items: { type: "string" },
                minItems: 4,
                maxItems: 4
              },
              answer: { type: "string" },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] }
            }
          }
        }
      }
    };

    const prompt = `
You are an expert teaching assistant.
From the following text, create ${questionCount} multiple-choice questions.
Each question has 4 options, one correct answer, and a difficulty tag ("easy", "medium", or "hard").
User selected difficulty mode: "${difficulty}".
- If "mixed": distribute evenly across all 3 levels.
- If "easy" | "medium" | "hard": make all questions that level.
Return JSON in this exact shape: { "quiz": [ { "question": "...", "options": [...], "answer": "...", "difficulty": "..." } ] }

Text:
"""${text.slice(0, 40000)}"""`;

    /* ---------- call Responses API with new syntax ---------- */
    const completion = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "mcq_list",
          schema, // correct field name
        },
      },
    });

    /* ---------- parse output ---------- */
    const outText =
      completion.output?.[0]?.content?.[0]?.text ??
      completion.output_text ??
      "{}";
    const parsed = JSON.parse(outText);
    const quiz = Array.isArray(parsed.quiz) ? parsed.quiz : [];

    res.json({ quiz });
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
