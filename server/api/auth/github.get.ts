import { createGithubAuthorizationUrl } from '../../utils/github'

export default defineEventHandler(async (event) => sendRedirect(event, await createGithubAuthorizationUrl(event, 'sign-in')))
