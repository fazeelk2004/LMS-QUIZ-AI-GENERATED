import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "file-saver";

const QuizGenerator = () => {
  // ---- state ----
  const [file, setFile] = useState(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  const [quiz, setQuiz] = useState([]);
  const [type, setType] = useState("mcq");       // "mcq" | "short"

  // progress/loader states
  const [loading, setLoading] = useState(false);  // API in-flight
  const [showProgress, setShowProgress] = useState(false); // whether bar is visible
  const [progress, setProgress] = useState(0);
  const progTimerRef = useRef(null);              // holds setInterval id

  // ---- progress manager ----
  useEffect(() => {
    // cleanup any previous interval
    if (progTimerRef.current) {
      clearInterval(progTimerRef.current);
      progTimerRef.current = null;
    }

    if (loading) {
      setShowProgress(true);
      setProgress(0);

      // simulate a smooth ramp up to ~95%
      progTimerRef.current = setInterval(() => {
        setProgress((p) => (p >= 95 ? p : Math.min(95, p + Math.random() * 6 + 2)));
      }, 250);
    } else {
      // finish pulse to 100, then hide
      setProgress((p) => (p < 100 ? 100 : p));
      const t = setTimeout(() => {
        setShowProgress(false);
        setProgress(0);
      }, 300);
      return () => clearTimeout(t);
    }

    return () => {
      if (progTimerRef.current) {
        clearInterval(progTimerRef.current);
        progTimerRef.current = null;
      }
    };
  }, [loading]);

  // ---- unified generator ----
  const generate = async (mode) => {
    if (!file) return alert("Please upload a file.");
    setType(mode);
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("questionCount", Number(questionCount));
    formData.append("difficulty", difficulty);
    formData.append("mode", mode); // <-- decides MCQ vs Short on server

    try {
      const res = await axios.post("http://localhost:5000/api/generate-quiz", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const result = res.data?.quiz;
      const t = res.data?.type || mode;
      setType(t);
      setQuiz(Array.isArray(result) ? result : []);
    } catch (err) {
      alert("Error: " + (err.response?.data?.error || err.message));
    } finally {
      // 1) stop interval + mark as not loading
      setLoading(false);
      // 2) progress effect will pulse to 100 and hide automatically
    }
  };

  // ---- export to Excel (unchanged from your latest, shortened for brevity) ----
  const exportToExcel = async () => {
    if (!quiz.length) return alert("No data to export.");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Quiz");

    const headers =
      type === "mcq"
        ? ["#", "Question", "Option A", "Option B", "Option C", "Option D", "Answer", "Difficulty"]
        : ["#", "Question", "Answer", "Difficulty"];

    const rows =
      type === "mcq"
        ? quiz.map((q, idx) => [
            idx + 1,
            q.question || "",
            q.options?.[0] ?? "",
            q.options?.[1] ?? "",
            q.options?.[2] ?? "",
            q.options?.[3] ?? "",
            q.answer ?? "",
            (q.difficulty || "").toUpperCase(),
          ])
        : quiz.map((q, idx) => [
            idx + 1,
            q.question || "",
            q.answer ?? "",
            (q.difficulty || "").toUpperCase(),
          ]);

    // double-row header (merged)
    const row1 = sheet.addRow(headers);
    const row2 = sheet.addRow(new Array(headers.length).fill(""));
    headers.forEach((_, i) => {
      const col = String.fromCharCode(65 + i);
      sheet.mergeCells(`${col}1:${col}2`);
    });
    [row1, row2].forEach((r) => {
      r.height = 30;
      r.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      });
    });

    rows.forEach((r) => sheet.addRow(r));

    const setCol = (i, width, wrap = false, center = false) => {
      sheet.getColumn(i).width = width;
      for (let r = 3; r <= sheet.rowCount; r++) {
        const cell = sheet.getCell(r, i);
        cell.alignment = {
          ...cell.alignment,
          wrapText: wrap,
          vertical: wrap ? "top" : "middle",
          horizontal: center ? "center" : cell.alignment?.horizontal,
        };
      }
    };

    if (type === "mcq") {
      setCol(1, 5, false, true);
      setCol(2, 80, true);
      setCol(3, 30, true);
      setCol(4, 30, true);
      setCol(5, 30, true);
      setCol(6, 30, true);
      setCol(7, 35, true); // Answer multi-line
      setCol(8, 14, false, true);
    } else {
      setCol(1, 5, false, true);
      setCol(2, 80, true);
      setCol(3, 50, true); // Answer multi-line
      setCol(4, 14, false, true);
    }

    sheet.views = [{ state: "frozen", ySplit: 2 }];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      type === "mcq" ? "quiz-mcqs.xlsx" : "quiz-short.xlsx"
    );
  };

  // ---- export to Word (unchanged for brevity) ----
  const exportToDocx = async () => {
    if (!quiz.length) return alert("No data to export.");
    const children = [
      new Paragraph({
        text: type === "mcq" ? "Generated Quiz (MCQs)" : "Generated Quiz (Short Questions)",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
    ];
    if (type === "mcq") {
      quiz.forEach((q, i) => {
        const n = i + 1;
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${n}. `, bold: true }),
              new TextRun({ text: q.question || "" }),
              new TextRun({ text: q?.difficulty ? `  [${q.difficulty.toUpperCase()}]` : "", italics: true }),
            ],
            spacing: { before: 240, after: 120 },
          })
        );
        const labels = ["A", "B", "C", "D"];
        (q.options || []).forEach((opt, j) =>
          children.push(new Paragraph({ children: [new TextRun({ text: `${labels[j]}) `, bold: true }), new TextRun({ text: opt || "" })] }))
        );
        children.push(new Paragraph({ children: [new TextRun({ text: "Answer: ", bold: true }), new TextRun({ text: q.answer || "" })] }));
      });
    } else {
      quiz.forEach((q, i) => {
        const n = i + 1;
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${n}. `, bold: true }),
              new TextRun({ text: q.question || "" }),
              new TextRun({ text: q?.difficulty ? `  [${q.difficulty.toUpperCase()}]` : "", italics: true }),
            ],
            spacing: { before: 240, after: 120 },
          })
        );
        children.push(new Paragraph({ children: [new TextRun({ text: "Answer: ", bold: true }), new TextRun({ text: q.answer || "" })] }));
      });
    }
    const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
    saveAs(blob, type === "mcq" ? "quiz-mcqs.docx" : "quiz-short.docx");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white shadow-lg rounded-2xl w-full max-w-2xl p-8">
        <h1 className="text-3xl font-bold text-center text-blue-600 mb-6">📘 AI Quiz Generator</h1>

        <div className="space-y-5">
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

          {/* Two generate buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => generate("mcq")}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              {loading && type === "mcq" ? "Generating…" : "Generate MCQs"}
            </button>
            <button
              onClick={() => generate("short")}
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition"
            >
              {loading && type === "short" ? "Generating…" : "Generate Short Qs"}
            </button>
          </div>
        </div>

        {/* Progress Bar: shows ONLY while showProgress is true */}
        {showProgress && (
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

            <h2 className="text-xl font-bold text-gray-800 mb-3">
              🧩 {type === "mcq" ? "Generated MCQs" : "Generated Short Questions"}
            </h2>

            {type === "mcq" ? (
              <div className="space-y-5">
                {quiz.map((q, i) => (
                  <div key={i} className="bg-gray-100 rounded-xl p-4 shadow-sm">
                    <p className="font-semibold">
                      {i + 1}. {q.question}{" "}
                      {q.difficulty && <span className="italic text-blue-600 text-sm">[{q.difficulty.toUpperCase()}]</span>}
                    </p>
                    <ul className="list-disc pl-5 mt-2 text-gray-700">
                      {q.options?.map((opt, idx) => (
                        <li key={idx}>{opt}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-green-600 font-medium">✅ Correct: {q.answer}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {quiz.map((q, i) => (
                  <div key={i} className="bg-gray-100 rounded-xl p-4 shadow-sm">
                    <p className="font-semibold">
                      {i + 1}. {q.question}{" "}
                      {q.difficulty && <span className="italic text-blue-600 text-sm">[{q.difficulty.toUpperCase()}]</span>}
                    </p>
                    <p className="mt-2 text-gray-700">
                      <b>Answer:</b> {q.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuizGenerator;
