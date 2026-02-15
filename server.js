const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet'); // Suggested adding this
const http = require('http');
const socketIo = require('socket.io');

// Load env vars
dotenv.config();

// App Setup
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' })); // Allow all for dev, restrict in prod
app.use(express.json());
// app.use(helmet()); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/tenants', require('./routes/tenant'));
// app.use('/api/inventory', require('./routes/inventory')); // To be implemented

// Database Connection
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('✅ MongoDB Connected'))
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