// App.jsx
// ✅ Adds difficulty selector (easy/medium/hard/mixed)
// ✅ Shows difficulty in UI
// ✅ Exports include Difficulty column in Excel + Word

import React, { useState } from "react";
import axios from "axios";

// Excel (safe)
import ExcelJS from "exceljs";
// Word + save
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { saveAs } from "file-saver";

const QuizGenerator = () => {
  const [file, setFile] = useState(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed"); // NEW
  const [quiz, setQuiz] = useState([]);
  const [loading, setLoading] = useState(false);

  // ---- Generate quiz from backend ----
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please upload a file.");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("questionCount", Number(questionCount));
    formData.append("difficulty", difficulty); // NEW

    try {
      setLoading(true);
      const res = await axios.post(
        "http://localhost:5000/api/generate-quiz",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const result = res.data?.quiz;
      setQuiz(Array.isArray(result) ? result : []);
    } catch (err) {
      alert("Error: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // ---- Export to Excel ----
  const exportToExcel = async () => {
    if (!Array.isArray(quiz) || quiz.length === 0) {
      alert("No quiz to export.");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Quiz");

    // header row (includes Difficulty)
    sheet.addRow(["#", "Question", "Option A", "Option B", "Option C", "Option D", "Answer", "Difficulty"]);

    // data rows
    quiz.forEach((q, idx) => {
      sheet.addRow([
        idx + 1,
        q.question,
        q.options?.[0] ?? "",
        q.options?.[1] ?? "",
        q.options?.[2] ?? "",
        q.options?.[3] ?? "",
        q.answer ?? "",
        q.difficulty ?? ""
      ]);
    });

    // widths
    sheet.columns = [
      { width: 4 },    // #
      { width: 80 },   // Question
      { width: 30 },   // A
      { width: 30 },   // B
      { width: 30 },   // C
      { width: 30 },   // D
      { width: 12 },   // Answer
      { width: 12 }    // Difficulty
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, "quiz.xlsx");
  };

  // ---- Export to Word ----
  const exportToDocx = async () => {
    if (!Array.isArray(quiz) || quiz.length === 0) {
      alert("No quiz to export.");
      return;
    }

    const children = [
      new Paragraph({
        text: "Generated Quiz",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
    ];

    quiz.forEach((q, idx) => {
      const qNum = idx + 1;

      // Question (append difficulty label inline)
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${qNum}. `, bold: true }),
            new TextRun({ text: q.question || "" }),
            new TextRun({
              text: q?.difficulty ? `  [${q.difficulty.toUpperCase()}]` : "",
              italics: true,
            }),
          ],
          spacing: { before: 240, after: 120 },
        })
      );

      const labels = ["A", "B", "C", "D"];
      (q.options || []).forEach((opt, i) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${labels[i]}) `, bold: true }),
              new TextRun({ text: opt || "" }),
            ],
            spacing: { after: 60 },
          })
        );
      });

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Answer: ", bold: true }),
            new TextRun({ text: q.answer || "" }),
          ],
          spacing: { after: 120 },
        })
      );
    });

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, "quiz.docx");
  };

  return (
    <div style={{ maxWidth: "760px", margin: "40px auto" }}>
      <h2>📘 Generate Quiz from Document</h2>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <br /><br />

        <label>
          Number of Questions:{" "}
          <input
            type="number"
            min="1"
            max="20"
            value={questionCount}
            onChange={(e) => setQuestionCount(e.target.value)}
          />
        </label>

        <br /><br />

        {/* NEW: difficulty selector */}
        <label>
          Difficulty:{" "}
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="mixed">Mixed</option>
            <option value="easy">Easy only</option>
            <option value="medium">Medium only</option>
            <option value="hard">Hard only</option>
          </select>
        </label>

        <br /><br />

        <button type="submit" disabled={loading}>
          {loading ? "Generating..." : "Generate Quiz"}
        </button>
      </form>

      <hr />

      {quiz.length > 0 && (
        <div>
          <h3>🧩 Generated Quiz</h3>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={exportToExcel}>⬇️ Download as Excel</button>
            <button onClick={exportToDocx}>⬇️ Download as Word</button>
          </div>

          {quiz.map((q, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <strong>
                {i + 1}. {q.question}{" "}
                {q?.difficulty && (
                  <span style={{ fontWeight: 500, fontStyle: "italic" }}>
                    [{q.difficulty.toUpperCase()}]
                  </span>
                )}
              </strong>
              <ul>
                {q.options?.map((opt, idx) => (
                  <li key={idx}>{opt}</li>
                ))}
              </ul>
              <p><b>Answer:</b> {q.answer}</p>
              <hr />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuizGenerator;
