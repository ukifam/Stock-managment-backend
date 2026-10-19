const router = require('express').Router()
const pipelineController = require('../controllers/pipelineController')

router.get('/', pipelineController.listPipelines)
router.post('/', pipelineController.upsertPipeline)
router.post('/bulk', pipelineController.bulkUpsertPipelines)
router.delete('/:id', pipelineController.deletePipeline)

module.exports = router
