const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const httpError = require('../utils/httpError')
const { JWT_SECRET } = require('../middleware/authMiddleware')

async function register(req, res, next) {
  try {
    const { username, email, password } = req.body
    if (!username || !email || !password) {
      throw httpError(400, 'Username, email, and password are required')
    }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      throw httpError(409, 'An account with this email already exists')
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await User.create({
      username: username.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'admin',
    })

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.status(201).json({
      token,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    next(error)
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      throw httpError(400, 'Email and password are required')
    }

    const normalizedEmail = email.toLowerCase().trim()
    const user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      throw httpError(401, 'Invalid email or password')
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      throw httpError(401, 'Invalid email or password')
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    next(error)
  }
}

async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('-password')
    if (!user) {
      throw httpError(404, 'User not found')
    }

    res.json({
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      role: user.role,
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  register,
  login,
  me,
}
