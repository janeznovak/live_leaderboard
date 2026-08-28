import { database } from '../utils/database'

export default defineEventHandler(async () => {
  const result = await database().query('SELECT id, name, slug FROM games ORDER BY name')
  return result.rows
})
