import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URL || 'mongodb://localhost:27017/pitch_room_ai';
  await mongoose.connect(uri);
  console.log('✓  MongoDB connected');
}
