const path = require('node:path')
const mongoose = require('mongoose')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

async function main() {
  const ownerKey = String(process.argv[2] || '').trim().toLowerCase()
  if (!/^acceptance-[a-f0-9]{8}@example\.test$/.test(ownerKey)) {
    throw new Error('Refusing cleanup: ownerKey is not a generated acceptance-test tenant')
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured')

  await mongoose.connect(process.env.MONGODB_URI)
  let deletedDocuments = 0
  let deletedCollections = 0
  try {
    const collections = await mongoose.connection.db.collections()
    for (const collection of collections) {
      const result = await collection.deleteMany({ ownerKey })
      if (result.deletedCount > 0) {
        deletedDocuments += result.deletedCount
        deletedCollections += 1
      }
    }
    console.log(JSON.stringify({ deletedCollections, deletedDocuments }))
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
