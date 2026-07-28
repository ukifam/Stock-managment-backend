const router = require('express').Router()
const venueController = require('../controllers/venueController')

router.get('/', venueController.listVenues)
router.get('/:code', venueController.getVenue)
router.post('/', venueController.createVenue)
router.patch('/:code', venueController.updateVenue)
router.delete('/:code', venueController.deleteVenue)

module.exports = router
