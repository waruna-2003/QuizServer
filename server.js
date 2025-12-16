const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());

let participants = [];
let studentQuizMappings = {}; // Store randomization mapping per student

// Student joins
app.post('/api/join', (req, res) => {
  const { name } = req.body;

  const id = uuidv4();  // unique ID
  participants.push({ id, name });

  console.log(`New participant: ${name} (ID: ${id})`);

  res.json({ message: 'Joined successfully!', id });
});

// Admin gets list
app.get('/api/participants', (req, res) => {
  res.json(participants);
});

// Shuffle array using Fisher-Yates algorithm
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Apply randomization to quiz for a specific student
function applyRandomization(quiz, studentId) {
  // If no randomization settings, return original quiz
  if (!quiz.randomization) {
    return { quiz, mapping: null };
  }

  const { shuffleQuestions, shuffleOptions, useQuestionPool, poolSize } = quiz.randomization;
  let questions = [...quiz.questions];
  let questionMapping = []; // Maps display index to original index
  let optionMappings = []; // Maps display options to original options per question

  // Question pool - select random subset
  if (useQuestionPool && poolSize > 0 && poolSize < questions.length) {
    const shuffled = shuffleArray(questions.map((q, idx) => ({ question: q, originalIndex: idx })));
    const selected = shuffled.slice(0, poolSize);
    questions = selected.map(item => item.question);
    questionMapping = selected.map(item => item.originalIndex);
  } else {
    questionMapping = questions.map((_, idx) => idx);
  }

  // Shuffle questions
  if (shuffleQuestions) {
    const indexed = questions.map((q, idx) => ({ question: q, mappedIndex: questionMapping[idx] }));
    const shuffled = shuffleArray(indexed);
    questions = shuffled.map(item => item.question);
    questionMapping = shuffled.map(item => item.mappedIndex);
  }

  // Shuffle options for each question
  questions = questions.map((q, qIdx) => {
    const qType = q.type || 'multiple-choice';

    // Only shuffle for questions with options
    if (shuffleOptions && (qType === 'multiple-choice' || qType === 'true-false' || qType === 'multiple-answer')) {
      if (q.options) {
        const optionKeys = Object.keys(q.options);
        const shuffledKeys = shuffleArray(optionKeys);

        // Create new options object with shuffled order
        const newOptions = {};
        const optionMapping = {};

        shuffledKeys.forEach((key, newIdx) => {
          const newKey = String.fromCharCode(65 + newIdx); // A, B, C, D...
          newOptions[newKey] = q.options[key];
          optionMapping[newKey] = key; // Maps new position to original letter
        });

        optionMappings[qIdx] = optionMapping;

        return {
          ...q,
          options: newOptions
        };
      }
    }

    optionMappings[qIdx] = null;
    return q;
  });

  return {
    quiz: { ...quiz, questions },
    mapping: {
      questionMapping,
      optionMappings
    }
  };
}

// Current quiz API - returns current session with randomization per student
app.get('/api/currentQuiz', (req, res) => {
  const { studentId } = req.query;
  const sessionRefPath = path.join(__dirname, 'currentSession.json');

  if (fs.existsSync(sessionRefPath)) {
    const sessionRef = JSON.parse(fs.readFileSync(sessionRefPath));
    if (fs.existsSync(sessionRef.sessionPath)) {
      const quiz = JSON.parse(fs.readFileSync(sessionRef.sessionPath));

      // Apply randomization if student ID provided
      if (studentId) {
        // Check if we already have a mapping for this student
        if (!studentQuizMappings[studentId]) {
          const { quiz: randomizedQuiz, mapping } = applyRandomization(quiz, studentId);
          studentQuizMappings[studentId] = {
            quiz: randomizedQuiz,
            mapping: mapping
          };
        }

        res.json(studentQuizMappings[studentId].quiz);
      } else {
        res.json(quiz);
      }
    } else {
      res.status(404).json({ message: "Session file not found" });
    }
  } else {
    res.status(404).json({ message: "No quiz session started yet" });
  }
});

// Reverse map answers back to original question order
function reverseMapAnswers(participantId, answers) {
  const studentMapping = studentQuizMappings[participantId];
  if (!studentMapping || !studentMapping.mapping) {
    // No randomization, return answers as-is
    return answers;
  }

  const { questionMapping, optionMappings } = studentMapping.mapping;
  const originalQuiz = JSON.parse(fs.readFileSync(path.join(__dirname, 'currentSession.json')));
  const sessionRef = JSON.parse(fs.readFileSync(path.join(__dirname, 'currentSession.json')));
  const quiz = JSON.parse(fs.readFileSync(sessionRef.sessionPath));
  const totalQuestions = quiz.questions.length;

  // Create array with null values for all original questions
  const mappedAnswers = new Array(totalQuestions).fill(null);

  answers.forEach((answer, displayIndex) => {
    const originalIndex = questionMapping[displayIndex];
    let mappedAnswer = answer;

    // Reverse map options if they were shuffled
    if (optionMappings[displayIndex]) {
      const optionMapping = optionMappings[displayIndex];

      if (Array.isArray(answer)) {
        // Multiple answer - map each option back
        mappedAnswer = answer.map(opt => optionMapping[opt] || opt);
      } else if (typeof answer === 'string' && optionMapping[answer]) {
        // Single option - map back
        mappedAnswer = optionMapping[answer];
      }
    }

    mappedAnswers[originalIndex] = mappedAnswer;
  });

  return mappedAnswers;
}

// Example submit answers (students)
app.post('/api/submit', (req, res) => {
  const { participantId, answers, timeSpent, autoSubmitted, timeoutReason } = req.body;
  const sessionRefPath = path.join(__dirname, 'currentSession.json');

  if (!fs.existsSync(sessionRefPath)) {
    return res.status(400).json({ message: "No active quiz session" });
  }

  const sessionRef = JSON.parse(fs.readFileSync(sessionRefPath));
  if (!fs.existsSync(sessionRef.sessionPath)) {
    return res.status(400).json({ message: "Session file not found" });
  }

  const quiz = JSON.parse(fs.readFileSync(sessionRef.sessionPath));

  // Reverse map answers back to original order
  const mappedAnswers = reverseMapAnswers(participantId, answers);

  // Find participant name
  const participant = participants.find(p => p.id === participantId);
  const participantName = participant ? participant.name : 'Unknown';

  // Evaluate score using mapped answers
  let score = 0;
  let pendingManualGrading = 0;
  let totalGradeable = 0;
  const detailedResults = [];

  quiz.questions.forEach((q, idx) => {
    const qType = q.type || 'multiple-choice';
    const studentAnswer = mappedAnswers[idx];
    let isCorrect = false;
    let needsManualGrading = false;

    switch(qType) {
      case 'multiple-choice':
      case 'true-false':
        if (studentAnswer && studentAnswer === q.correct) {
          isCorrect = true;
          score++;
        }
        totalGradeable++;
        break;

      case 'multiple-answer':
        // Check if arrays match (order doesn't matter)
        if (studentAnswer && Array.isArray(studentAnswer) && Array.isArray(q.correct)) {
          const studentSet = new Set(studentAnswer);
          const correctSet = new Set(q.correct);

          if (studentSet.size === correctSet.size &&
              [...studentSet].every(item => correctSet.has(item))) {
            isCorrect = true;
            score++;
          }
        }
        totalGradeable++;
        break;

      case 'fill-blank':
        // Check against all acceptable answers (exact match)
        if (studentAnswer && Array.isArray(q.correct)) {
          if (q.correct.some(correctAns => correctAns === studentAnswer)) {
            isCorrect = true;
            score++;
          }
        }
        totalGradeable++;
        break;

      case 'matching':
        // Check if all matches are correct
        if (studentAnswer && Array.isArray(studentAnswer) && Array.isArray(q.correct)) {
          if (studentAnswer.length === q.correct.length) {
            const allCorrect = studentAnswer.every((ans, i) => ans === q.correct[i]);
            if (allCorrect) {
              isCorrect = true;
              score++;
            }
          }
        }
        totalGradeable++;
        break;

      case 'short-answer':
        // Requires manual grading
        needsManualGrading = true;
        pendingManualGrading++;
        break;
    }

    detailedResults.push({
      questionIndex: idx,
      questionType: qType,
      studentAnswer: studentAnswer,
      isCorrect: isCorrect,
      needsManualGrading: needsManualGrading,
      manualScore: needsManualGrading ? null : (isCorrect ? 1 : 0)
    });
  });

  // Save results to session file
  quiz.results.push({
    participantId,
    participantName,
    score,
    totalQuestions: quiz.questions.length,
    totalGradeable,
    pendingManualGrading,
    submittedAt: new Date().toISOString(),
    answers: mappedAnswers, // Store mapped answers in original order
    originalAnswers: answers, // Store original student answers for reference
    detailedResults,
    timeSpent: timeSpent || 0,
    autoSubmitted: autoSubmitted || false,
    timeoutReason: timeoutReason || null,
    timeLimit: quiz.totalTimeLimit || null,
    wasRandomized: studentQuizMappings[participantId] ? true : false,
    questionMapping: studentQuizMappings[participantId]?.mapping?.questionMapping || null
  });
  fs.writeFileSync(sessionRef.sessionPath, JSON.stringify(quiz, null, 2));

  console.log(`📝 ${participantName} submitted quiz - Score: ${score}/${totalGradeable}${pendingManualGrading > 0 ? ` (${pendingManualGrading} pending manual grading)` : ''}`);

  res.json({
    score,
    totalQuestions: quiz.questions.length,
    totalGradeable,
    pendingManualGrading
  });
});

// Get all quiz sessions
app.get('/api/sessions', (req, res) => {
  const sessionsDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    return res.json([]);
  }

  const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const sessions = sessionFiles.map(file => {
    const sessionData = JSON.parse(fs.readFileSync(path.join(sessionsDir, file)));
    return {
      sessionId: sessionData.sessionId,
      quizName: sessionData.name,
      sessionDate: sessionData.sessionDate,
      participantCount: sessionData.results ? sessionData.results.length : 0,
      fileName: file
    };
  });

  // Sort by date, newest first
  sessions.sort((a, b) => new Date(b.sessionDate) - new Date(a.sessionDate));

  res.json(sessions);
});

// Get specific session details
app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionPath = path.join(__dirname, 'sessions', `${sessionId}.json`);

  if (fs.existsSync(sessionPath)) {
    const sessionData = JSON.parse(fs.readFileSync(sessionPath));
    res.json(sessionData);
  } else {
    res.status(404).json({ message: "Session not found" });
  }
});

// Save manually graded session
app.post('/api/sessions/:sessionId/save', (req, res) => {
  const { sessionId } = req.params;
  const sessionData = req.body;
  const sessionPath = path.join(__dirname, 'sessions', `${sessionId}.json`);

  try {
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
    console.log(`✅ Manual grades saved for session: ${sessionId}`);
    res.json({ message: "Grades saved successfully" });
  } catch (error) {
    console.error('Error saving grades:', error);
    res.status(500).json({ message: "Failed to save grades" });
  }
});

// ========== QUIZ MANAGEMENT ENDPOINTS ==========

// Ensure quizzes directory exists
const quizzesDir = path.join(__dirname, 'quizzes');
if (!fs.existsSync(quizzesDir)) {
  fs.mkdirSync(quizzesDir);
}

// Get all quizzes
app.get('/api/quizzes', (req, res) => {
  try {
    if (!fs.existsSync(quizzesDir)) {
      return res.json([]);
    }

    const quizFiles = fs.readdirSync(quizzesDir).filter(f => f.endsWith('.json'));
    const quizzes = quizFiles.map(file => {
      try {
        const quizData = JSON.parse(fs.readFileSync(path.join(quizzesDir, file)));
        // Ensure legacy quizzes (saved without an `id`) expose a usable id derived from filename
        const fileId = path.basename(file, '.json');
        if (!quizData.id) quizData.id = fileId;
        return quizData;
      } catch (error) {
        console.error(`Error reading quiz file ${file}:`, error);
        return null;
      }
    }).filter(q => q !== null);

    res.json(quizzes);
  } catch (error) {
    console.error('Error loading quizzes:', error);
    res.status(500).json({ message: 'Failed to load quizzes' });
  }
});

// Get specific quiz by ID
app.get('/api/quizzes/:quizId', (req, res) => {
  const { quizId } = req.params;
  const quizPath = path.join(quizzesDir, `${quizId}.json`);

  if (fs.existsSync(quizPath)) {
    const quizData = JSON.parse(fs.readFileSync(quizPath));
    res.json(quizData);
  } else {
    res.status(404).json({ message: 'Quiz not found' });
  }
});

// Create new quiz
app.post('/api/quizzes', (req, res) => {
  try {
    const quizData = req.body;
    const quizId = uuidv4();

    const quiz = {
      id: quizId,
      name: quizData.name,
      description: quizData.description || '',
      category: quizData.category || 'Other',
      difficulty: quizData.difficulty || 'Medium',
      questions: quizData.questions || [],
      totalTimeLimit: quizData.totalTimeLimit || null,
      randomization: quizData.randomization || null,
      isTemplate: quizData.isTemplate || false,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const quizPath = path.join(quizzesDir, `${quizId}.json`);
    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));

    console.log(`✅ Quiz created: ${quiz.name} (ID: ${quizId})`);
    res.json(quiz);
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({ message: 'Failed to create quiz' });
  }
});

// Update existing quiz
app.put('/api/quizzes/:quizId', (req, res) => {
  try {
    const { quizId } = req.params;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const existingQuiz = JSON.parse(fs.readFileSync(quizPath));
    const updatedQuiz = {
      ...existingQuiz,
      ...req.body,
      id: quizId, // Preserve ID
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(quizPath, JSON.stringify(updatedQuiz, null, 2));
    console.log(`✅ Quiz updated: ${updatedQuiz.name}`);
    res.json(updatedQuiz);
  } catch (error) {
    console.error('Error updating quiz:', error);
    res.status(500).json({ message: 'Failed to update quiz' });
  }
});

// Start quiz session
app.post('/api/quizzes/start', (req, res) => {
  try {
    const { quizId } = req.body;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = JSON.parse(fs.readFileSync(quizPath));

    // Create session from quiz
    const sessionId = uuidv4();
    const sessionData = {
      ...quiz,
      sessionId: sessionId,
      sessionDate: new Date().toISOString(),
      results: []
    };

    // Save to sessions directory
    const sessionsDir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir);
    }

    const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));

    // Update currentSession reference
    const sessionRef = {
      sessionId: sessionId,
      sessionPath: sessionPath,
      quizId: quizId
    };
    fs.writeFileSync(path.join(__dirname, 'currentSession.json'), JSON.stringify(sessionRef, null, 2));

    // Clear participants and mappings for new session
    participants = [];
    studentQuizMappings = {};

    console.log(`🚀 Quiz session started: ${quiz.name} (Session ID: ${sessionId})`);
    res.json({ sessionId, message: 'Quiz session started successfully' });
  } catch (error) {
    console.error('Error starting quiz session:', error);
    res.status(500).json({ message: 'Failed to start quiz session' });
  }
});

// Duplicate quiz
app.post('/api/quizzes/duplicate', (req, res) => {
  try {
    const { quizId, newName } = req.body;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const originalQuiz = JSON.parse(fs.readFileSync(quizPath));
    const newQuizId = uuidv4();

    const newQuiz = {
      ...originalQuiz,
      id: newQuizId,
      name: newName,
      isTemplate: false, // Duplicated quizzes are not templates by default
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const newQuizPath = path.join(quizzesDir, `${newQuizId}.json`);
    fs.writeFileSync(newQuizPath, JSON.stringify(newQuiz, null, 2));

    console.log(`📋 Quiz duplicated: ${originalQuiz.name} → ${newName}`);
    res.json(newQuiz);
  } catch (error) {
    console.error('Error duplicating quiz:', error);
    res.status(500).json({ message: 'Failed to duplicate quiz' });
  }
});

// Archive quiz
app.put('/api/quizzes/:quizId/archive', (req, res) => {
  try {
    const { quizId } = req.params;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = JSON.parse(fs.readFileSync(quizPath));
    quiz.isArchived = true;
    quiz.archivedAt = new Date().toISOString();
    quiz.updatedAt = new Date().toISOString();

    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
    console.log(`📦 Quiz archived: ${quiz.name}`);
    res.json(quiz);
  } catch (error) {
    console.error('Error archiving quiz:', error);
    res.status(500).json({ message: 'Failed to archive quiz' });
  }
});

// Unarchive quiz
app.put('/api/quizzes/:quizId/unarchive', (req, res) => {
  try {
    const { quizId } = req.params;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = JSON.parse(fs.readFileSync(quizPath));
    quiz.isArchived = false;
    delete quiz.archivedAt;
    quiz.updatedAt = new Date().toISOString();

    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
    console.log(`📂 Quiz restored: ${quiz.name}`);
    res.json(quiz);
  } catch (error) {
    console.error('Error restoring quiz:', error);
    res.status(500).json({ message: 'Failed to restore quiz' });
  }
});

// Delete quiz
app.delete('/api/quizzes/:quizId', (req, res) => {
  try {
    const { quizId } = req.params;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = JSON.parse(fs.readFileSync(quizPath));
    const quizName = quiz.name;

    fs.unlinkSync(quizPath);
    console.log(`🗑️ Quiz deleted: ${quizName}`);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    console.error('Error deleting quiz:', error);
    res.status(500).json({ message: 'Failed to delete quiz' });
  }
});

// Save quiz as template
app.put('/api/quizzes/:quizId/template', (req, res) => {
  try {
    const { quizId } = req.params;
    const quizPath = path.join(quizzesDir, `${quizId}.json`);

    if (!fs.existsSync(quizPath)) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = JSON.parse(fs.readFileSync(quizPath));
    quiz.isTemplate = true;
    quiz.updatedAt = new Date().toISOString();

    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
    console.log(`📋 Quiz saved as template: ${quiz.name}`);
    res.json(quiz);
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ message: 'Failed to save as template' });
  }
});

// Get question bank (all unique questions from all quizzes)
app.get('/api/question-bank', (req, res) => {
  try {
    if (!fs.existsSync(quizzesDir)) {
      return res.json([]);
    }

    const quizFiles = fs.readdirSync(quizzesDir).filter(f => f.endsWith('.json'));
    const questionMap = new Map();

    quizFiles.forEach(file => {
      try {
        const quiz = JSON.parse(fs.readFileSync(path.join(quizzesDir, file)));
        if (quiz.questions && Array.isArray(quiz.questions)) {
          quiz.questions.forEach(q => {
            const key = q.question.toLowerCase().trim();
            if (!questionMap.has(key)) {
              questionMap.set(key, {
                ...q,
                category: quiz.category,
                difficulty: quiz.difficulty,
                quizCount: 1
              });
            } else {
              const existing = questionMap.get(key);
              existing.quizCount++;
            }
          });
        }
      } catch (error) {
        console.error(`Error reading quiz file ${file}:`, error);
      }
    });

    const questions = Array.from(questionMap.values());
    res.json(questions);
  } catch (error) {
    console.error('Error loading question bank:', error);
    res.status(500).json({ message: 'Failed to load question bank' });
  }
});

// Serve admin through /admin route too (alternative)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
