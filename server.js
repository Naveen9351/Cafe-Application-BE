const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

dotenv.config();
const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'https://cafe-application-fe.vercel.app/' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('MongoDB connected');
    await createDefaultAdmin();
  })
  .catch(err => console.error(err));

app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));


const server = app.listen(process.env.PORT || 5000, () => 
  console.log(`Server running on port ${process.env.PORT}`)
);

const io = require('socket.io')(server, { 
  cors: { origin: process.env.FRONTEND_URL || 'https://cafe-application-fe.vercel.app/' } 
});
global.io = io; 
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
});

async function createDefaultAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;


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
      console.log("Default admin created:", adminEmail);
    } else {
      console.log("ℹAdmin already exists:", adminEmail);
    }
  } catch (err) {
    console.error("Error creating default admin:", err.message);
  }
}
