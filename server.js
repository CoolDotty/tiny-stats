const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const PORT = process.env.PORT || 7828;
const INTERVAL = process.env.INTERVAL || 1000;

// Track previous CPU times for usage calculation
let prevCpuTimes = os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b) }));

function getCpuUsage() {
  const cpus = os.cpus();
  let totalUsage = 0;

  cpus.forEach((cpu, i) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b);
    const idle = cpu.times.idle;
    const deltaTotal = total - prevCpuTimes[i].total;
    const deltaIdle = idle - prevCpuTimes[i].idle;
    totalUsage += deltaTotal > 0 ? (1 - deltaIdle / deltaTotal) * 100 : 0;
    prevCpuTimes[i] = { idle, total };
  });

  return totalUsage / cpus.length;
}

function getDiskUsage() {
  try {
    const output = execSync('df -B1 --total 2>/dev/null | tail -1', { encoding: 'utf8' });
    const parts = output.trim().split(/\s+/);
    return { total: parseInt(parts[1]), used: parseInt(parts[2]) };
  } catch {
    return { total: 0, used: 0 };
  }
}

function getStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const disk = getDiskUsage();

  return {
    cpu: {
      usage: getCpuUsage()
    },
    ram: {
      total: totalMem,
      used: usedMem,
      usage: (usedMem / totalMem) * 100
    },
    storage: {
      total: disk.total,
      used: disk.used,
      usage: disk.total > 0 ? (disk.used / disk.total) * 100 : 0
    },
    timestamp: Date.now()
  };
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

const wss = new WebSocketServer({ server, verifyClient: () => true });

const clients = new Set();

wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);
  ws.on('close', () => { console.log('Client disconnected'); clients.delete(ws); });
  ws.on('error', () => clients.delete(ws));
});

setInterval(() => {
  if (clients.size === 0) return;
  const data = JSON.stringify(getStats());
  for (const client of clients) {
    if (client.readyState === 1) client.send(data);
  }
}, INTERVAL);

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}\nServer running on ws://localhost:${PORT}`));
