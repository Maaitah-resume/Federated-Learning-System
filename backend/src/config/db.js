const mongoose = require('mongoose');
const { env }  = require('./env');

const connectDB = async () => {
  try {
    if (!env.MONGODB_URI) {
      console.warn('MONGODB_URI is not configured. Database connection skipped.');
      return;
    }
    const conn = await mongoose.connect(env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

module.exports = { connectDB };
