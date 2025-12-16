// Quiz Library Management System

let allQuizzes = [];
let currentTab = 'quizzes';

// Load all quizzes on page load
document.addEventListener('DOMContentLoaded', () => {
  loadQuizzes();
});

// Load quizzes from server
async function loadQuizzes() {
  try {
    const response = await fetch('/api/quizzes');
    if (response.ok) {
      allQuizzes = await response.json();
      renderQuizzes();
    } else {
      console.error('Failed to load quizzes');
      showEmptyState();
    }
  } catch (error) {
    console.error('Error loading quizzes:', error);
    showEmptyState();
  }
}

// Render quizzes based on current tab and filters
function renderQuizzes() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const categoryFilter = document.getElementById('category-filter').value;
  const difficultyFilter = document.getElementById('difficulty-filter').value;

  // Filter based on tab
  let filteredQuizzes = allQuizzes.filter(quiz => {
    if (currentTab === 'templates') {
      return quiz.isTemplate === true;
    } else if (currentTab === 'archived') {
      return quiz.isArchived === true;
    } else {
      return !quiz.isTemplate && !quiz.isArchived;
    }
  });

  // Apply search filter
  if (searchTerm) {
    filteredQuizzes = filteredQuizzes.filter(quiz =>
      quiz.name.toLowerCase().includes(searchTerm) ||
      (quiz.category && quiz.category.toLowerCase().includes(searchTerm))
    );
  }

  // Apply category filter
  if (categoryFilter) {
    filteredQuizzes = filteredQuizzes.filter(quiz => quiz.category === categoryFilter);
  }

  // Apply difficulty filter
  if (difficultyFilter) {
    filteredQuizzes = filteredQuizzes.filter(quiz => quiz.difficulty === difficultyFilter);
  }

  // Render to appropriate grid
  const gridId = currentTab === 'templates' ? 'templates-grid' :
                 currentTab === 'archived' ? 'archived-grid' : 'quizzes-grid';
  const grid = document.getElementById(gridId);

  if (filteredQuizzes.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <h3>No quizzes found</h3>
        <p style="color: var(--gray-600);">
          ${currentTab === 'templates' ? 'Create your first template' :
            currentTab === 'archived' ? 'No archived quizzes' :
            'Create a new quiz to get started'}
        </p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredQuizzes.map(quiz => createQuizCard(quiz)).join('');
}

// Create HTML for a quiz card
function createQuizCard(quiz) {
  const questionCount = quiz.questions ? quiz.questions.length : 0;
  const timeLimit = quiz.totalTimeLimit ? formatTime(quiz.totalTimeLimit) : 'No limit';
  const difficultyClass = quiz.difficulty ? `badge-difficulty-${quiz.difficulty.toLowerCase()}` : 'badge-difficulty-medium';

  return `
    <div class="quiz-card" data-quiz-id="${quiz.id}">
      <div class="quiz-header">
        <div class="quiz-title">${escapeHtml(quiz.name)}</div>
      </div>
      <div class="quiz-meta">
        ${quiz.category ? `<span class="badge badge-category"><i class="fas fa-tag"></i> ${quiz.category}</span>` : ''}
        ${quiz.difficulty ? `<span class="badge ${difficultyClass}">${quiz.difficulty}</span>` : ''}
        ${quiz.isTemplate ? '<span class="badge badge-template"><i class="fas fa-layer-group"></i> Template</span>' : ''}
        ${quiz.isArchived ? '<span class="badge badge-archived"><i class="fas fa-archive"></i> Archived</span>' : ''}
      </div>
      <div class="quiz-stats">
        <span class="quiz-stat">
          <i class="fas fa-question-circle"></i> ${questionCount} question${questionCount !== 1 ? 's' : ''}
        </span>
        <span class="quiz-stat">
          <i class="fas fa-clock"></i> ${timeLimit}
        </span>
      </div>
      ${quiz.description ? `<p style="font-size: 0.875rem; color: var(--gray-600); margin-top: 0.5rem;">${escapeHtml(quiz.description)}</p>` : ''}
      <div class="quiz-actions">
        <button class="action-btn" onclick="startQuiz('${quiz.id}')" title="Start Quiz">
          <i class="fas fa-play"></i> Start
        </button>
        <button class="action-btn" onclick="editQuiz('${quiz.id}')" title="Edit Quiz">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="action-btn" onclick="duplicateQuiz('${quiz.id}')" title="Duplicate Quiz">
          <i class="fas fa-copy"></i> Duplicate
        </button>
        ${!quiz.isArchived ?
          `<button class="action-btn" onclick="archiveQuiz('${quiz.id}')" title="Archive Quiz">
            <i class="fas fa-archive"></i> Archive
          </button>` :
          `<button class="action-btn" onclick="unarchiveQuiz('${quiz.id}')" title="Restore Quiz">
            <i class="fas fa-undo"></i> Restore
          </button>`
        }
        <button class="action-btn action-btn-danger" onclick="deleteQuiz('${quiz.id}')" title="Delete Quiz">
          <i class="fas fa-trash"></i> Delete
        </button>
        ${!quiz.isTemplate ?
          `<button class="action-btn" onclick="saveAsTemplate('${quiz.id}')" title="Save as Template">
            <i class="fas fa-save"></i> Template
          </button>` : ''
        }
      </div>
    </div>
  `;
}

// Format time in seconds to human-readable format
function formatTime(seconds) {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    return `${seconds}s`;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Switch between tabs
function switchTab(tabName) {
  currentTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  event.target.closest('.tab').classList.add('active');

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');

  renderQuizzes();
}

// Filter quizzes based on search and filters
function filterQuizzes() {
  renderQuizzes();
}

// Start a quiz session
async function startQuiz(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) {
    alert('Quiz not found');
    return;
  }

  if (confirm(`Start quiz session for "${quiz.name}"?`)) {
    try {
      const response = await fetch('/api/quizzes/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId })
      });

      if (response.ok) {
        alert('Quiz session started! Students can now join.');
        window.location.href = 'admin_welcome.html';
      } else {
        alert('Failed to start quiz session');
      }
    } catch (error) {
      console.error('Error starting quiz:', error);
      alert('Error starting quiz session');
    }
  }
}

// Edit an existing quiz
function editQuiz(quizId) {
  // Store quiz ID in localStorage so create_quiz.html can load it
  localStorage.setItem('editQuizId', quizId);
  window.location.href = 'create_quiz.html';
}

// Duplicate a quiz
async function duplicateQuiz(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) {
    alert('Quiz not found');
    return;
  }

  const newName = prompt('Enter name for duplicated quiz:', `${quiz.name} (Copy)`);
  if (!newName) return;

  try {
    const response = await fetch('/api/quizzes/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId, newName })
    });

    if (response.ok) {
      alert('Quiz duplicated successfully!');
      loadQuizzes();
    } else {
      alert('Failed to duplicate quiz');
    }
  } catch (error) {
    console.error('Error duplicating quiz:', error);
    alert('Error duplicating quiz');
  }
}

// Archive a quiz
async function archiveQuiz(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) return;

  if (confirm(`Archive "${quiz.name}"?`)) {
    try {
      const response = await fetch(`/api/quizzes/${quizId}/archive`, {
        method: 'PUT'
      });

      if (response.ok) {
        alert('Quiz archived successfully!');
        loadQuizzes();
      } else {
        alert('Failed to archive quiz');
      }
    } catch (error) {
      console.error('Error archiving quiz:', error);
      alert('Error archiving quiz');
    }
  }
}

// Unarchive a quiz
async function unarchiveQuiz(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) return;

  if (confirm(`Restore "${quiz.name}"?`)) {
    try {
      const response = await fetch(`/api/quizzes/${quizId}/unarchive`, {
        method: 'PUT'
      });

      if (response.ok) {
        alert('Quiz restored successfully!');
        loadQuizzes();
      } else {
        alert('Failed to restore quiz');
      }
    } catch (error) {
      console.error('Error restoring quiz:', error);
      alert('Error restoring quiz');
    }
  }
}

// Delete a quiz permanently
async function deleteQuiz(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) return;

  if (confirm(`⚠️ Permanently delete "${quiz.name}"? This cannot be undone!`)) {
    try {
      const response = await fetch(`/api/quizzes/${quizId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('Quiz deleted successfully!');
        loadQuizzes();
      } else {
        alert('Failed to delete quiz');
      }
    } catch (error) {
      console.error('Error deleting quiz:', error);
      alert('Error deleting quiz');
    }
  }
}

// Save quiz as template
async function saveAsTemplate(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) return;

  if (confirm(`Save "${quiz.name}" as a reusable template?`)) {
    try {
      const response = await fetch(`/api/quizzes/${quizId}/template`, {
        method: 'PUT'
      });

      if (response.ok) {
        alert('Quiz saved as template!');
        loadQuizzes();
      } else {
        alert('Failed to save as template');
      }
    } catch (error) {
      console.error('Error saving template:', error);
      alert('Error saving template');
    }
  }
}

// Show question bank modal
async function showQuestionBank() {
  const modal = document.getElementById('question-bank-modal');
  const content = document.getElementById('question-bank-content');

  try {
    const response = await fetch('/api/question-bank');
    if (response.ok) {
      const questions = await response.json();

      if (questions.length === 0) {
        content.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-database"></i>
            <h3>No questions in bank</h3>
            <p style="color: var(--gray-600);">Questions from quizzes will appear here</p>
          </div>
        `;
      } else {
        content.innerHTML = `
          <div style="margin-bottom: 1rem;">
            <input type="text" id="question-search" placeholder="Search questions..."
              oninput="filterQuestionBank()"
              style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
          </div>
          <div id="question-list" style="display: flex; flex-direction: column; gap: 1rem; max-height: 400px; overflow-y: auto;">
            ${questions.map((q, idx) => `
              <div class="question-bank-item" style="padding: 1rem; background: var(--gray-50); border-radius: 8px; border: 2px solid var(--gray-200);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                  <strong style="flex: 1;">${idx + 1}. ${escapeHtml(q.question)}</strong>
                  <span class="badge ${q.type === 'multiple-choice' ? 'badge-category' : 'badge-template'}"
                    style="margin-left: 0.5rem; white-space: nowrap;">
                    ${q.type || 'multiple-choice'}
                  </span>
                </div>
                ${q.category ? `<span class="badge badge-category" style="margin-right: 0.5rem;">${q.category}</span>` : ''}
                ${q.difficulty ? `<span class="badge badge-difficulty-${q.difficulty.toLowerCase()}">${q.difficulty}</span>` : ''}
                <div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--gray-600);">
                  Used in: ${q.quizCount || 0} quiz${q.quizCount !== 1 ? 'zes' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    } else {
      content.innerHTML = '<p style="color: var(--danger);">Failed to load question bank</p>';
    }
  } catch (error) {
    console.error('Error loading question bank:', error);
    content.innerHTML = '<p style="color: var(--danger);">Error loading question bank</p>';
  }

  modal.style.display = 'flex';
}

// Filter question bank
function filterQuestionBank() {
  const searchTerm = document.getElementById('question-search').value.toLowerCase();
  const items = document.querySelectorAll('.question-bank-item');

  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(searchTerm) ? 'block' : 'none';
  });
}

// Close question bank modal
function closeQuestionBank() {
  document.getElementById('question-bank-modal').style.display = 'none';
}

// Show import CSV modal
function showImportModal() {
  document.getElementById('import-modal').style.display = 'flex';
}

// Close import CSV modal
function closeImportModal() {
  document.getElementById('import-modal').style.display = 'none';
  document.getElementById('csv-file').value = '';
}

// Import questions from CSV
async function importCSV() {
  const fileInput = document.getElementById('csv-file');
  const file = fileInput.files[0];

  if (!file) {
    alert('Please select a CSV file');
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const csvText = e.target.result;
      const questions = parseCSV(csvText);

      if (questions.length === 0) {
        alert('No valid questions found in CSV');
        return;
      }

      // Create new quiz with imported questions
      const quizName = prompt('Enter name for imported quiz:', file.name.replace('.csv', ''));
      if (!quizName) return;

      const response = await fetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: quizName,
          questions: questions,
          category: 'Other',
          difficulty: 'Medium'
        })
      });

      if (response.ok) {
        alert(`Successfully imported ${questions.length} questions!`);
        closeImportModal();
        loadQuizzes();
      } else {
        alert('Failed to create quiz from imported questions');
      }
    } catch (error) {
      console.error('Error importing CSV:', error);
      alert('Error parsing CSV file. Please check the format.');
    }
  };

  reader.readAsText(file);
}

// Parse CSV file into questions array
function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  const questions = [];

  // Skip header row if it exists
  const startIndex = lines[0].toLowerCase().includes('question') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handle quoted fields)
    const fields = parseCSVLine(line);

    if (fields.length < 2) continue;

    const question = fields[0];
    const type = fields[1] || 'multiple-choice';

    const questionObj = {
      question: question,
      type: type
    };

    // Multiple choice: question,type,optionA,optionB,optionC,optionD,correct,explanation
    if (type === 'multiple-choice' && fields.length >= 7) {
      questionObj.options = {
        A: fields[2],
        B: fields[3],
        C: fields[4],
        D: fields[5]
      };
      questionObj.correct = fields[6];
      if (fields[7]) questionObj.explanation = fields[7];
    }
    // True/False: question,type,correct,explanation
    else if (type === 'true-false' && fields.length >= 3) {
      questionObj.options = { A: 'True', B: 'False' };
      questionObj.correct = fields[2];
      if (fields[3]) questionObj.explanation = fields[3];
    }
    // Fill in blank: question,type,correctAnswer1;correctAnswer2,explanation
    else if (type === 'fill-blank' && fields.length >= 3) {
      questionObj.correct = fields[2].split(';');
      if (fields[3]) questionObj.explanation = fields[3];
    }
    // Short answer: question,type,explanation
    else if (type === 'short-answer') {
      if (fields[2]) questionObj.explanation = fields[2];
    }

    questions.push(questionObj);
  }

  return questions;
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

// Show empty state
function showEmptyState() {
  const grids = ['quizzes-grid', 'templates-grid', 'archived-grid'];
  grids.forEach(gridId => {
    const grid = document.getElementById(gridId);
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <h3>No quizzes found</h3>
        <p style="color: var(--gray-600);">Create a new quiz to get started</p>
      </div>
    `;
  });
}

// Close modals when clicking outside
window.onclick = function(event) {
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });
};
