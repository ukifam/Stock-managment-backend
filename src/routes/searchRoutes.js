const router = require('express').Router()
const searchController = require('../controllers/searchController')

router.get('/inventory', searchController.searchInventory)
router.get('/', searchController.searchAll)

module.exports = router
