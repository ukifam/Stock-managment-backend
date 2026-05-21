const mongoose = require('mongoose')

async function connectDB() {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error('MONGODB_URI is missing from .env')
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: Number(process.env.DB_TIMEOUT_MS || 5000),
  })
  console.log(`MongoDB connected: ${mongoose.connection.name}`)
}

module.exports = connectDB
