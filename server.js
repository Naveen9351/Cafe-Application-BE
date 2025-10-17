const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

dotenv.config();
const app = express();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'https://cafe-application-fe.vercel.app/' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Enhanced MongoDB connection with proper error handling
async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Remove deprecated options - they're not needed in modern Mongoose
      // useNewUrlParser: true, 
      // useUnifiedTopology: true,
      
      // Add these for better connection handling
      serverSelectionTimeoutMS: 30000, // 30 seconds timeout
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    });

    console.log('✅ MongoDB connected successfully');
    console.log('📊 Database:', conn.connection.name);
    
    // Create default admin only after successful connection
    await createDefaultAdmin();
    
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('💡 Check your MONGO_URI and Atlas settings');
    
    // Exit process on connection failure (optional - prevents app from running without DB)
    process.exit(1);
  }
}

// Connection event listeners
mongoose.connection.on('connected', () => {
  console.log('🔗 Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('🔌 Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('👋 App terminated');
  process.exit(0);
});

// Connect to DB before starting server
connectDB().then(() => {
  // Only start server after DB connection
  startServer();
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

function startServer() {
  const server = app.listen(process.env.PORT || 5000, () => {
    console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
  });

  // Socket.IO setup
  const io = require('socket.io')(server, { 
    cors: { origin: process.env.FRONTEND_URL || 'https://cafe-application-fe.vercel.app' } 
  });
  global.io = io; 
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
  });

  // Routes (only after DB connection)
  app.use('/api/menu', require('./routes/menu'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/admin', require('./routes/admin'));
}

async function createDefaultAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.log('⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set in .env');
      return;
    }

    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      admin = new User({
        name: "Default Admin",
        email: adminEmail,
        password: hashedPassword,
        role: "admin"
      });
      await admin.save();
      console.log("✅ Default admin created:", adminEmail);
    } else {
      console.log("ℹ️ Admin already exists:", adminEmail);
    }
  } catch (err) {
    console.error("❌ Error creating default admin:", err.message);
  }
}