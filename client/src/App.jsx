import React, { useState, useEffect } from "react";
import axios from "axios";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "file-saver";

const QuizGenerator = () => {
  const [file, setFile] = useState(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  const [quiz, setQuiz] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let interval;
    if (loading) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => (prev >= 95 ? prev : prev + Math.random() * 5));
      }, 300);
    } else {
      clearInterval(interval);
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please upload a file.");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("questionCount", Number(questionCount));
    formData.append("difficulty", difficulty);

    try {
      setLoading(true);
      const res = await axios.post("http://localhost:5000/api/generate-quiz", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const result = res.data?.quiz;
      setQuiz(Array.isArray(result) ? result : []);
    } catch (err) {
      alert("Error: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
      setProgress(100);
      setTimeout(() => setProgress(0), 1000);
    }
  };

  // ---- Export to Excel (multi-line Answer too) ----
  const exportToExcel = async () => {
    if (!Array.isArray(quiz) || quiz.length === 0) {
      alert("No quiz to export.");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Quiz");

    // headers & rows
    const headers = ["#", "Question", "Option A", "Option B", "Option C", "Option D", "Answer", "Difficulty"];
    const rows = quiz.map((q, idx) => [
      idx + 1,
      q.question || "",
      q.options?.[0] ?? "",
      q.options?.[1] ?? "",
      q.options?.[2] ?? "",
      q.options?.[3] ?? "",
      q.answer ?? "",
      (q.difficulty || "").toUpperCase()
    ]);

    // --- create 2-row header (merged) ---
    const row1 = sheet.addRow(headers);
    const row2 = sheet.addRow(new Array(headers.length).fill(""));
    headers.forEach((_, i) => {
      const col = String.fromCharCode(65 + i);
      sheet.mergeCells(`${col}1:${col}2`);
    });

    // header styling
    [row1, row2].forEach((r) => {
      r.height = 30;
      r.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FFCBD5E1" } },
          left: { style: "thin", color: { argb: "FFCBD5E1" } },
          bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
          right: { style: "thin", color: { argb: "FFCBD5E1" } }
        };
      });
    });

    // add quiz rows
    rows.forEach((r) => sheet.addRow(r));

    // widths + wrap alignment
    const widths = [5, 80, 30, 30, 30, 30, 35, 14];
    widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    // wrap for question, options & answer columns
    for (let r = 3; r <= sheet.rowCount; r++) {
      ["B", "C", "D", "E", "F", "G"].forEach((col) => {
        const cell = sheet.getCell(`${col}${r}`);
        cell.alignment = { wrapText: true, vertical: "top" };
      });
      // Difficulty centered
      const diff = sheet.getCell(`H${r}`);
      diff.alignment = { horizontal: "center", vertical: "middle" };
    }

    // freeze header rows
    sheet.views = [{ state: "frozen", ySplit: 2 }];

    // borders for all cells
    const border = { style: "thin", color: { argb: "FFE2E8F0" } };
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = { top: border, left: border, bottom: border, right: border };
      });
    });

    // save file
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "quiz.xlsx"
    );
  };




  const exportToDocx = async () => {
    if (!quiz.length) return alert("No quiz to export.");
    const children = [
      new Paragraph({
        text: "Generated Quiz",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
    ];
    quiz.forEach((q, idx) => {
      const qNum = idx + 1;
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${qNum}. `, bold: true }),
            new TextRun({ text: q.question }),
            new TextRun({
              text: q.difficulty ? `  [${q.difficulty.toUpperCase()}]` : "",
              italics: true,
            }),
          ],
          spacing: { before: 240, after: 120 },
        })
      );
      const labels = ["A", "B", "C", "D"];
      q.options.forEach((opt, i) =>
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${labels[i]}) `, bold: true }), new TextRun({ text: opt })],
            spacing: { after: 60 },
          })
        )
      );
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "Answer: ", bold: true }), new TextRun({ text: q.answer })],
          spacing: { after: 120 },
        })
      );
    });
    const doc = new Document({ sections: [{ children }] });
    saveAs(await Packer.toBlob(doc), "quiz.docx");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white shadow-lg rounded-2xl w-full max-w-2xl p-8">
        <h1 className="text-3xl font-bold text-center text-primary mb-6">📘 AI Quiz Generator</h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            type="file"
            accept=".pdf,.docx,.pptx,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 
              file:rounded-full file:border-0 file:text-sm file:font-semibold 
              file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-600">
              Questions
              <input
                type="number"
                min="1"
                max="20"
                value={questionCount}
                onChange={(e) => setQuestionCount(e.target.value)}
                className="ml-2 w-20 px-2 py-1 border rounded-md text-center focus:outline-none focus:ring focus:ring-blue-300"
              />
            </label>

            <label className="text-sm font-medium text-gray-600">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="ml-2 px-2 py-1 border rounded-md focus:outline-none focus:ring focus:ring-blue-300"
              >
                <option value="mixed">Mixed</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            {loading ? "Generating..." : "Generate Quiz"}
          </button>
        </form>

        {loading && (
          <div className="w-full bg-gray-200 rounded-full h-3 mt-6 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-sky-400 to-blue-300 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {quiz.length > 0 && (
          <div className="mt-10">
            <div className="flex gap-3 justify-center mb-6">
              <button
                onClick={exportToExcel}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                ⬇️ Download Excel
              </button>
              <button
                onClick={exportToDocx}
                className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                ⬇️ Download Word
              </button>
            </div>

            <h2 className="text-xl font-bold text-gray-800 mb-3">🧩 Generated Quiz</h2>
            <div className="space-y-5">
              {quiz.map((q, i) => (
                <div key={i} className="bg-gray-100 rounded-xl p-4 shadow-sm">
                  <p className="font-semibold">
                    {i + 1}. {q.question}{" "}
                    {q.difficulty && (
                      <span className="italic text-blue-600 text-sm">
                        [{q.difficulty.toUpperCase()}]
                      </span>
                    )}
                  </p>
                  <ul className="list-disc pl-5 mt-2 text-gray-700">
                    {q.options?.map((opt, idx) => (
                      <li key={idx}>{opt}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-green-600 font-medium">
                    ✅ Correct: {q.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuizGenerator;
