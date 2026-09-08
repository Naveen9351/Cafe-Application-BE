const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet'); // Suggested adding this
const http = require('http');
const socketIo = require('socket.io');
const dns = require('dns');

// Force Node.js to use Google DNS to bypass local ISP SRV resolution issues
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
  console.log('🌐 App DNS resolver set to Google DNS (8.8.8.8)');
} catch (err) {
  console.warn('⚠️ Failed to set custom DNS servers:', err.message);
}

// Load env vars
dotenv.config();

// App Setup
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);
    
    // Automatically permit all Vercel preview/production domains, localhost, and custom URLs
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
    
    // Fallback permit
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'Origin', 'Accept', 'X-Requested-With']
}));

// Express cors middleware automatically handles preflight OPTIONS requests for all registered endpoints.
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint for uptime pingers (prevents Render cold starts)
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date() }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/tenants', require('./routes/tenant'));
app.use('/api/petpooja', require('./routes/petpooja'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/leads', require('./routes/leads'));

// Database Connection
const seedDatabase = require('./utils/seeder');

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => {
    console.log('✅ MongoDB Connected');
    seedDatabase();
  })
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Socket.io Setup
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all for dev
    methods: ["GET", "POST"]
  }
});

// Store io globally for use in routes
global.io = io;

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join Tenant Room
  socket.on('joinTenant', (tenantId) => {
    if (tenantId) {
      socket.join(tenantId);
      console.log(`Socket ${socket.id} joined tenant room: ${tenantId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const cleanupTask = require('./utils/cleanup');

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Run cleanup once on startup
  setTimeout(cleanupTask, 5000); // Wait for DB connection to be solid

  // Then run every 24 hours
  setInterval(cleanupTask, 24 * 60 * 60 * 1000);
});