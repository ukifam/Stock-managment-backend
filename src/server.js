require('dotenv').config()

const app = require('./app')
const connectDB = require('./config/db')
const storeModel = require('./models/storeModel')

const PORT = Number(process.env.PORT || 5000)

if (process.argv.includes('--check')) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing from .env')
  }

  console.log('Backend check passed')
} else {
  startServer().catch((error) => {
    console.error(`Server failed to start: ${error.message}`)
    process.exit(1)
  })
}

async function startServer() {
  await connectDB()
  await storeModel.ensureStore()

  app.listen(PORT, () => {
    console.log(`Stock backend running on http://localhost:${PORT}`)
  })
}
