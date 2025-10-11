import React, { useState } from "react";
import axios from "axios";

const QuizGenerator = () => {
  const [file, setFile] = useState(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [quiz, setQuiz] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please upload a file.");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("questionCount", questionCount);

    try {
      setLoading(true);
      const res = await axios.post("http://localhost:5000/api/generate-quiz", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setQuiz(res.data.quiz);
    } catch (err) {
      alert("Error: " + err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "auto" }}>
      <h2>📘 Generate Quiz from Document</h2>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <br /><br />

        <label>
          Number of Questions:{" "}
          <input
            type="number"
            min="1"
            max="10"
            value={questionCount}
            onChange={(e) => setQuestionCount(e.target.value)}
          />
        </label>

        <br /><br />
        <button type="submit" disabled={loading}>
          {loading ? "Generating..." : "Generate Quiz"}
        </button>
      </form>

      <hr />

      {Array.isArray(quiz) && quiz.length > 0 && (
        <div>
          <h3>🧩 Generated Quiz:</h3>
          {quiz.map((q, i) => (
            <div key={i}>
              <strong>{i + 1}. {q.question}</strong>
              <ul>
                {q.options.map((opt, idx) => (
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
