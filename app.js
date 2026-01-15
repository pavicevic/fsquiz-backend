const API = "http://localhost:3000";

let CURRENT_QUESTIONS = [];
let CURRENT_QUIZ_ID = null;
let LAST_RESULT = null;

// =======================
// LOAD EVENTS
// =======================
async function loadEvents() {
    const r = await fetch(API + "/api/events");
    const events = await r.json();
    const sel = document.getElementById("eventSelect");
    sel.innerHTML = "";

    events.forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.id;
        opt.textContent = `${e.short_name} – ${e.event_name}`;
        sel.appendChild(opt);
    });
}
loadEvents();

// =======================
// GENERATE QUIZ
// =======================
async function generateQuiz() {
    const eventId = eventSelect.value;
    const ys = yearStart.value;
    const ye = yearEnd.value;
    const cn = classSelect.value;
    const count = countInput.value;

    let url = `${API}/api/generateRange?eventId=${eventId}&yearStart=${ys}&yearEnd=${ye}&count=${count}`;
    if (cn) url += `&className=${cn}`;

    const r = await fetch(url);
    const data = await r.json();

    CURRENT_QUIZ_ID = data.quizId;

    // 🔒 deduplikacija pitanja po ID-u
    const map = new Map();
    data.questions.forEach(q => {
        if (!map.has(q.id)) map.set(q.id, q);
    });
    CURRENT_QUESTIONS = Array.from(map.values());

    renderQuiz(CURRENT_QUESTIONS);

    submitButton.style.display = "block";
    pdfQuestionsButton.style.display = "block";
    pdfButton.style.display = "none";
}

// =======================
// RENDER QUIZ
// =======================
function renderQuiz(questions) {
    quizContainer.innerHTML = "";

    questions.forEach((q, index) => {
        let div = document.createElement("div");
        div.className = "question";

        let html = `<h3>${index + 1}. ${q.text.replace(/\n/g, "<br>")}</h3>`;

        // IMAGES
        if (q.images && q.images.length > 0) {
            q.images.forEach(img => {
        
                let imgUrl = "";
        
                // Case 1: backend already returned full URL
                if (typeof img === "string") {
                    imgUrl = img;
                }
                // Case 2: FS Quiz raw object
                else if (img.path) {
                    imgUrl = `https://img.fs-quiz.eu/${img.path}`;
                }
                else {
                    return; // safety
                }
        
                html += `
                <div style="margin:10px 0;">
                    <img src="${imgUrl}" style="max-width:100%;"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
                    <a href="${imgUrl}" target="_blank" style="display:none; font-size:12px;">
                        Open image
                    </a>
                </div>`;
            });
        }
        
        

        // OPEN QUESTION
        if (!q.answers || q.answers.length <= 1) {
            html += `<input type="text" name="q_${q.id}" class="input" style="width:100%;">`;
        }
        // MULTIPLE CHOICE
        else {
            q.answers.forEach(a => {
                html += `
                <label>
                    <input type="radio" name="q_${q.id}" value="${a.id}">
                    ${a.text}
                </label><br>`;
            });
        }

        html += `</div>`;
        div.innerHTML = html;
        quizContainer.appendChild(div);
    });
}

// =======================
// SUBMIT QUIZ
// =======================
async function submitQuiz() {
    const answers = CURRENT_QUESTIONS.map(q => {
        let sel = [];

        if (!q.answers || q.answers.length <= 1) {
            sel = [
                document.querySelector(`input[name="q_${q.id}"]`)?.value.trim() || ""
            ];
        } else {
            sel = [...document.querySelectorAll(`input[name="q_${q.id}"]:checked`)]
                .map(i => Number(i.value));
        }

        return { questionId: q.id, selected: sel };
    });

    const r = await fetch(API + "/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: CURRENT_QUIZ_ID, answers })
    });

    LAST_RESULT = await r.json();
    renderResults(LAST_RESULT);

    pdfButton.style.display = "block";
}

// =======================
// RENDER RESULTS
// =======================
function renderResults(result) {
    const box = document.getElementById("resultContainer");

    const getAnswerText = (qId, aId) => {
        const q = CURRENT_QUESTIONS.find(q => q.id === qId);
        if (!q) return aId;
        const a = q.answers?.find(x => x.id === aId);
        return a ? a.text : aId;
    };

    let html = `<h2>Results</h2>`;
    html += `<p>Score: ${result.score} / ${result.total}</p>`;
    html += `<ul>`;

    result.results.forEach((res, index) => {
        const userText = res.userAnswers
            .map(a => getAnswerText(res.questionId, a))
            .join(", ");

        const correctText = res.correctAnswers
            .map(a => getAnswerText(res.questionId, a))
            .join(", ");

        html += `
        <li style="margin-bottom:12px;">
            <strong>${index + 1}.</strong><br>
            <strong>Your answer:</strong> ${userText || "-"}<br>
            <strong>Correct answer:</strong> ${correctText}<br>
            <strong>Status:</strong> ${res.correct ? "✅ Correct" : "❌ Wrong"}
        </li>`;
    });

    html += `</ul>`;
    box.innerHTML = html;
}

// =======================
// EXPORT PDF (QUESTIONS)
// =======================
async function exportQuestionsPDF() {
    const r = await fetch(API + "/api/exportPDFQuestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            quizId: CURRENT_QUIZ_ID,
            questions: CURRENT_QUESTIONS
        })
    });

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    window.open(url);
}
