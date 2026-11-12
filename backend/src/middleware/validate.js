export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const error = new Error("Validation failed");
    error.status = 422;
    error.details = result.error.issues.map(({ path, message }) => ({ path, message }));
    return next(error);
  }
  req.validatedBody = result.data;
  return next();
};
