import http from 'node:http'

const profiles = {
  'github-player': { id: '1001', login: 'github-player', email: 'github-player@example.test' },
  'link-local': { id: '2001', login: 'linked-local', email: 'linked-local@example.test' },
  'link-state': { id: '2002', login: 'linked-state', email: 'linked-state@example.test' },
  collision: { id: '1000', login: 'Ada', email: 'collision@example.test' },
}
let nextAuthorizationCode = 'github-player'

function profileFor(request) {
  const token = request.headers.authorization?.replace(/^Bearer stub-/, '')
  return token && profiles[token]
}

http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://github:4000')
  if (url.pathname === '/health') {
    response.writeHead(204)
    return response.end()
  }
  if (url.pathname === '/__test/authorization-code' && request.method === 'POST') {
    let body = ''
    for await (const chunk of request) body += chunk
    const code = JSON.parse(body).code
    if (!profiles[code]) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: 'unknown_profile' }))
    }
    nextAuthorizationCode = code
    response.writeHead(204)
    return response.end()
  }
  if (url.pathname === '/login/oauth/authorize') {
    const redirectUrl = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')
    if (!redirectUrl || !state) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: 'invalid_request' }))
    }
    const callbackUrl = new URL(redirectUrl)
    callbackUrl.searchParams.set('state', state)
    callbackUrl.searchParams.set('code', nextAuthorizationCode)
    response.writeHead(302, { Location: callbackUrl.toString() })
    return response.end()
  }
  if (url.pathname === '/login/oauth/access_token' && request.method === 'POST') {
    let body = ''
    for await (const chunk of request) body += chunk
    const code = new URLSearchParams(body).get('code')
    if (!code || !profiles[code]) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: 'bad_verification_code' }))
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ access_token: `stub-${code}`, token_type: 'bearer' }))
  }
  const profile = profileFor(request)
  if (url.pathname === '/user' && profile) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ ...profile, email: 'unverified-public@example.test' }))
  }
  if (url.pathname === '/user/emails' && profile) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify([{ email: profile.email, primary: true, verified: true }]))
  }
  response.writeHead(404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ error: 'not_found' }))
}).listen(4000, '0.0.0.0')
