const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet');
const http = require('http');
const socketIo = require('socket.io');
const dns = require('dns');

// Load env vars
dotenv.config();

// Optimize DNS lookup order for ultra-low latency (prefer IPv4)
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (err) {
  // Ignore if unsupported in older Node versions
}

// App Setup
const app = express();
const server = http.createServer(app);

// Response timing middleware (attaches X-Response-Time header to all responses)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${duration}ms`);
    }
  });
  next();
});

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('vercel.app') ||
      origin.includes('onrender.com') ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.onrender.com') ||
      (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL)
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'Origin', 'Accept', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '1d' }));

// Health check endpoint for uptime pingers
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date() }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/tenants', require('./routes/tenant'));
app.use('/api/petpooja', require('./routes/petpooja'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/customer', require('./routes/customerAuth'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/khata', require('./routes/khata'));
app.use('/api/admin', require('./routes/admin'));

// Database Connection with High-Speed Connection Pooling
const seedDatabase = require('./utils/seeder');

const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
  console.error('❌ MONGO_URI is not defined in .env file!');
} else {
  mongoose.connect(mongoURI, {
    maxPoolSize: 50,         // Maintain up to 50 active socket connections
    minPoolSize: 10,         // Keep 10 persistent socket connections warm
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4                // Skip IPv6 dual-stack resolution delays
  })
    .then(() => {
      console.log('⚡ MongoDB Connected with High-Speed Connection Pool (min: 10, max: 50)');
      seedDatabase();
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// Socket.io Setup
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

global.io = io;

io.on('connection', (socket) => {
  socket.on('joinTenant', (tenantId) => {
    if (tenantId) {
      socket.join(tenantId);
    }
  });
});

const cleanupTask = require('./utils/cleanup');

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 High-Performance Server running on port ${PORT}`);

  setTimeout(cleanupTask, 5000);
  setInterval(cleanupTask, 24 * 60 * 60 * 1000);
});