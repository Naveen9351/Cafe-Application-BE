const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');

dotenv.config({ path: '../.env' });
// Try loading local .env as fallback
dotenv.config();

try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
  console.log('App DNS set to Google DNS');
} catch (err) {
  console.log('DNS set error:', err.message);
}

console.log('Connecting to URI:', process.env.MONGO_URI);

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 8000
})
.then(() => {
  console.log('✅ Success! MongoDB is connected.');
  process.exit(0);
})
.catch(err => {
  console.error('❌ Failed! Connection error:', err);
  process.exit(1);
});
