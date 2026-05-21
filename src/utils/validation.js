function required(body, fields) {
  return fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '')
}

module.exports = {
  required,
}
