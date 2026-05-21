const path = require('path')

const ROOT_DIR = path.join(__dirname, '..', '..')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const DATA_FILE = path.join(DATA_DIR, 'store.json')

module.exports = {
  DATA_DIR,
  DATA_FILE,
}
