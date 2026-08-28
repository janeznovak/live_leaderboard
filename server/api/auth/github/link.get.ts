import { requireUser } from '../../../utils/auth'
import { createGithubAuthorizationUrl } from '../../../utils/github'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return sendRedirect(event, await createGithubAuthorizationUrl(event, 'link', user.id))
})
