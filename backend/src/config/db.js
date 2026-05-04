import mongoose from 'mongoose';
import { env } from './env.js';

export const connectDB = async () => {
  try {
    if (!env.MONGODB_URI) {
      console.warn('MONGODB_URI is not configured. Database connection skipped.');
      return;
    }
    
    const conn = await mongoose.connect(env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unknown error occurred during DB connection');
    }
    process.exit(1);
  }
};
