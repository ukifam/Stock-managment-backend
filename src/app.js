const express = require('express')
const cors = require('cors')
const routes = require('./routes')
const notFound = require('./middleware/notFound')
const errorHandler = require('./middleware/errorHandler')

const app = express()

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
app.use(express.json({ limit: '1mb' }))
app.use('/', routes)
app.use(notFound)
app.use(errorHandler)

module.exports = app
