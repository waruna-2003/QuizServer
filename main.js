const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

let currentQuiz = null;
let currentSessionId = null;
let serverProcess = null; // Store server process reference
const quizzesDir = path.join(__dirname, 'quizzes');
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(quizzesDir)) fs.mkdirSync(quizzesDir);
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

ipcMain.on('save-quiz', (event, quizData) => {
  const fileName = `${quizData.name.replace(/\s+/g, '_')}_${Date.now()}.json`;
  const filePath = path.join(quizzesDir, fileName);

  quizData.date = new Date().toISOString();
  quizData.results = [];

  fs.writeFileSync(filePath, JSON.stringify(quizData, null, 2));
  console.log("✅ Quiz saved:", fileName);
});

ipcMain.handle('get-quizzes', () => {
  const files = fs.readdirSync(quizzesDir).filter(f => f.endsWith('.json'));
  return files;
});

ipcMain.on('start-quiz', (event, quizFile) => {
  const filePath = path.join(quizzesDir, quizFile);
  if (fs.existsSync(filePath)) {
    const quizTemplate = JSON.parse(fs.readFileSync(filePath));

    // Create a new session with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionId = `${quizTemplate.name.replace(/\s+/g, '_')}_${timestamp}`;
    currentSessionId = sessionId;

    // Create session data with quiz template
    currentQuiz = {
      ...quizTemplate,
      sessionId: sessionId,
      sessionDate: new Date().toISOString(),
      results: []
    };

    console.log("▶ Quiz session started:", currentQuiz.name, "| Session ID:", sessionId);

    // Notify renderer (admin dashboard)
    event.sender.send('quiz-started', currentQuiz);

    // Save session to sessions directory
    const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(currentQuiz, null, 2));

    // Save current session reference so server.js can read it
    fs.writeFileSync(path.join(__dirname, 'currentSession.json'), JSON.stringify({
      sessionId: sessionId,
      sessionPath: sessionPath
    }, null, 2));
  }
});

function getAllLocalIPs() {
  const nets = os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      const isIPv4 = net.family === 'IPv4' && !net.internal;

      const skip = name.toLowerCase().includes('vmware') ||
                   name.toLowerCase().includes('virtual') ||
                   name.toLowerCase().includes('hyper') ||
                   name.toLowerCase().includes('vbox') ||
                   name.toLowerCase().includes('loopback');

      if (isIPv4 && !skip) {
        results.push({ name, address: net.address });
      }
    }
  }

  return results;
}

function startExpressServer() {
  if (serverProcess) {
    console.log('⚠️ Server already running');
    return;
  }

  console.log('🚀 Starting Express server...');
  serverProcess = spawn('node', ['server.js'], {
    shell: true,
    stdio: 'inherit',
    cwd: __dirname
  });

  serverProcess.on('error', (error) => {
    console.error('❌ Failed to start server:', error);
  });

  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    serverProcess = null;
  });

  console.log('✅ Express server started automatically');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('public/admin_welcome.html');

  // Auto-start the Express server
  startExpressServer();

  ipcMain.on('get-ips', (event) => {
    const ips = getAllLocalIPs();
    event.sender.send('available-ips', ips);
  });

  ipcMain.on('start-server', (event, selectedIP) => {
    // Start server if not already running
    if (!serverProcess) {
      startExpressServer();
    }

    const port = 3000;
    event.sender.send('server-started', { ip: selectedIP, port });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Kill the server process before quitting
  if (serverProcess) {
    console.log('🛑 Stopping Express server...');
    serverProcess.kill();
  }
  app.quit();
});

// Also cleanup on before-quit event
app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
