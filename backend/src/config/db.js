import mongoose from 'mongoose';
import { env } from './env.js';

export const connectDB = async () => {
  try {
    if (!env.MONGODB_URI || env.MONGODB_URI === 'mongodb+srv://maaitah2004_db_user:FiobSYpNKxLfAXBs@cluster0.zx7cbgt.mongodb.net/?appName=Cluster0') {
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
