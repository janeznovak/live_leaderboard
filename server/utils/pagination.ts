export function parseBoundedPositivePage(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Page must be a positive whole number.' })
  }
  const page = Number(value)
  if (!Number.isSafeInteger(page) || page > 10_000) {
    throw createError({ statusCode: 400, statusMessage: 'Page must be between 1 and 10000.' })
  }
  return page
}
