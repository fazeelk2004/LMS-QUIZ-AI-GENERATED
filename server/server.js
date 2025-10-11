import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import mammoth from "mammoth";
import OpenAI from "openai";
import dotenv from "dotenv";
import { createRequire } from "module";

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Extract text from file
async function extractText(filePath, mimetype) {
  if (mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  }

  if (
    mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error("Unsupported file type");
}

// ✅ Generate quiz
app.post("/api/generate-quiz", upload.single("file"), async (req, res) => {
  try {
    const { file } = req;
    const { questionCount = 5 } = req.body; // default 5 questions

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const text = await extractText(file.path, file.mimetype);

    const prompt = `
      You are an expert teacher assistant.
      From the following educational text, create ${questionCount} multiple-choice quiz questions.
      Each question should have 4 options and one correct answer.

      Return your response strictly as JSON in this format:
      [
        {
          "question": "string",
          "options": ["A", "B", "C", "D"],
          "answer": "A"
        }
      ]

      Text:
      ${text}
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // use gpt-4o-mini if your quota allows
      messages: [{ role: "user", content: prompt }],
    });

    let quiz = completion.choices[0].message.content.trim();
    try {
      quiz = JSON.parse(quiz);
    } catch {
      // fallback if not valid JSON
    }

    res.json({ quiz });
    fs.unlinkSync(file.path);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
