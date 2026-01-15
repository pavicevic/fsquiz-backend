import express from "express";
import cors from "cors";
import axios from "axios";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json());

// ============================
// IMAGE URL BUILDER
// ============================
function getImageURL(imgObj) {
    if (!imgObj || !imgObj.path) return null;
    return `https://img.fs-quiz.eu/${imgObj.path}`;
}

// ============================
// QUIZ STORAGE
// ============================
const QuizStore = {};

// ============================
// BASIC ROUTE
// ============================
app.get("/", (_, res) => res.send("FS Quiz Backend Running ✔"));

// ============================
// GET EVENTS
// ============================
app.get("/api/events", async (req, res) => {
    try {
        const r = await axios.get("https://api.fs-quiz.eu/2/event");
        res.json(r.data.events);
    } catch (e) {
        res.status(500).json({ error: "Failed to load events" });
    }
});

// ============================
// GENERATE RANGE QUIZ
// ============================
app.get("/api/generateRange", async (req, res) => {
    try {
        const { eventId, yearStart, yearEnd, className, count } = req.query;

        const n = Number(count) || 5;
        const y0 = Number(yearStart);
        const y1 = Number(yearEnd);

        let allQuizzes = [];

        for (let y = y0; y <= y1; y++) {
            let link = `https://api.fs-quiz.eu/2/event/${eventId}/quizzes?year=${y}`;
            if (className) link += `&class=${className}`;
            const r = await axios.get(link);
            allQuizzes.push(...r.data.quizzes);
        }

        let allQuestions = [];

        for (let q of allQuizzes) {
            const r = await axios.get(`https://api.fs-quiz.eu/2/quiz/${q.quiz_id}`);
            allQuestions.push(...r.data.questions);
        }

        const shuffled = allQuestions.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, n);

        const cleaned = selected.map(q => ({
            id: q.question_id,
            text: q.text,
            type: q.type,
            images: q.images?.map(im => getImageURL(im)) || [],
            answers: q.answers.map(a => ({
                id: a.answer_id,
                text: a.answer_text,
                is_correct: a.is_correct === true
            }))
        }));

        const quizId = Date.now().toString();

        QuizStore[quizId] = cleaned.map(q => ({
            id: q.id,
            correctAnswers: q.answers.filter(a => a.is_correct).map(a => a.id),
            solutions:
                q.answers.length <= 1
                    ? q.answers.map(a => a.text.toLowerCase().trim())
                    : null
        }));

        res.json({ quizId, questions: cleaned });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Quiz generation failed" });
    }
});

// ============================
// GRADE QUIZ
// ============================
app.post("/api/grade", (req, res) => {
    try {
        const { quizId, answers } = req.body;
        const stored = QuizStore[quizId];

        if (!stored) return res.status(404).json({ error: "Quiz not found" });

        let score = 0;
        const results = [];

        answers.forEach(ans => {
            const qInfo = stored.find(q => q.id == ans.questionId);
            if (!qInfo) return;

            let correct = false;

            if (qInfo.solutions !== null) {
                correct = qInfo.solutions.includes(
                    (ans.selected[0] || "").toLowerCase().trim()
                );
            } else {
                const ca = qInfo.correctAnswers;
                correct =
                    ca.length === ans.selected.length &&
                    ca.every(a => ans.selected.includes(a));
            }

            if (correct) score++;

            results.push({
                questionId: ans.questionId,
                correct,
                correctAnswers:
                    qInfo.solutions !== null
                        ? qInfo.solutions
                        : qInfo.correctAnswers,
                userAnswers: ans.selected
            });
        });

        res.json({ score, total: answers.length, results });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Grade failed" });
    }
});
// ============================
// EXPORT QUESTIONS PDF
// ============================
app.post("/api/exportPDFQuestions", async (req, res) => {
    try {
        const { quizId, questions } = req.body;

        res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename=questions_${quizId}.pdf`
        });

        const doc = new PDFDocument({ margin: 40 });
        doc.pipe(res);

        const PAGE_BOTTOM = doc.page.height - doc.page.margins.bottom;
        const MAX_IMAGE_HEIGHT = 350;

        // === LOGO ===
        try {
            doc.image("logo.png", { width: 120 });
        } catch {
            console.log("Logo not found");
        }

        doc.moveDown(2);

        // === TITLE ===
        doc.fontSize(22).text("FS Quiz – Questions", { align: "center" });
        doc.moveDown(2);

        // === QUESTIONS ===
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];

            // Provjera prostora (ako je ostalo malo do kraja, prebaci na novu stranu)
            if (doc.y > PAGE_BOTTOM - 100) {
                doc.addPage();
            }

            // ---- NASLOV PITANJA (Numerisano: 1., 2., 3...) ----
            doc
                .fontSize(14)
                .font("Helvetica-Bold")
                .text(`${i + 1}. ${q.text}`, { width: 520 });

            doc.moveDown(0.5);

            // ---- SLIKE ----
            if (q.images && q.images.length > 0) {
                for (const url of q.images) {
                    try {
                        const imgBuffer = (
                            await axios.get(url, { responseType: "arraybuffer" })
                        ).data;

                        if (doc.y > PAGE_BOTTOM - MAX_IMAGE_HEIGHT) {
                            doc.addPage();
                        }

                        doc.image(imgBuffer, {
                            fit: [500, MAX_IMAGE_HEIGHT],
                            align: "center"
                        });
                        doc.moveDown(1);
                    } catch {
                        doc.fontSize(10).fillColor("red").text("Image failed to load").fillColor("black");
                    }
                }
            }

            // ---- ODGOVORI (Numerisano: a), b), c)...) ----
            doc.font("Helvetica").fontSize(12);

            if (q.answers && q.answers.length > 1) {
                doc.text("Options:", { underline: true });
                doc.moveDown(0.2);

                q.answers.forEach((a, index) => {
                    // Prevara indexa u slovo (0=a, 1=b...)
                    const letter = String.fromCharCode(97 + index); 
                    doc.fontSize(11).text(`${letter}) ${a.text}`, {
                        indent: 20 // Malo uvučeno radi preglednosti
                    });
                });
            } else {
                doc.font("Helvetica-Oblique").text("(Open answer)", { indent: 20 });
            }

            // Razmak između dva pitanja i horizontalna linija (opciono)
            doc.moveDown(1.5);
            doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).strokeColor("#eeeeee").stroke();
            doc.moveDown(1);
        }

        doc.end();

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "PDF export failed" });
    }
});





// ============================
// START SERVER
// ============================
app.listen(3000, () =>
    console.log("Backend running at http://localhost:3000")
);
