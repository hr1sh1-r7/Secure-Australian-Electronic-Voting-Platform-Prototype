// SR-10: runs a Zod schema against the request body before the route sees it.
// Valid input replaces req.body (unknown fields removed); invalid input gets 400.
// The error lists which field failed, but never echoes the submitted value back,
function validate(schema, extra = {}) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {})
    if (!result.success) {
      return res.status(400).json({
        ...extra,
        error: 'Invalid input',
        fields: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(body)',
          problem: issue.message
        }))
      })
    }
    req.body = result.data
    next()
  }
}

module.exports = validate