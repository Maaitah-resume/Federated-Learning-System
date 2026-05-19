const mongoose = require('mongoose');
const { env }  = require('./env');

const connectDB = async () => {
  try {
    if (!env.MONGODB_URI) {
      console.warn('MONGODB_URI is not configured. Database connection skipped.');
      return;
    }

    const options = {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS:          45000,
      family:                   4,
      maxPoolSize:              10,
      minPoolSize:              2,
      heartbeatFrequencyMS:     10000,
    };

    const conn = await mongoose.connect(env.MONGODB_URI, options);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Reconnection events
    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB disconnected — attempting reconnect…');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[DB] MongoDB reconnected');
    });

    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB connection error:', err.message);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('[DB] MongoDB connection closed via SIGINT');
        process.exit(0);
      } catch (err) {
        console.error('[DB] Error closing MongoDB:', err.message);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('[DB] Connection error:', error.message);
    process.exit(1);
  }
};

module.exports = { connectDB };
