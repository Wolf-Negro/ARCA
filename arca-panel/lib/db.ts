import { randomBytes } from 'crypto'
import { v4 as uuidv4 } from 'uuid'

export interface Agency {
  id:         string
  name:       string
  code:       string
  team_id:    string
  active:     boolean
  created_at: string
}

function supabaseUrl() {
  const url = process.env.SUPABASE_URL
  if (!url) throw new Error('SUPABASE_URL not set')
  return url
}

function supabaseKey() {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set')
  return key
}

function headers() {
  return {
    'apikey':        supabaseKey(),
    'Authorization': `Bearer ${supabaseKey()}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  }
}

export async function listAgencies(): Promise<Agency[]> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/agencies?select=*&order=created_at.desc`,
    { headers: headers() },
  )
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
  return res.json()
}

export async function createAgency(name: string): Promise<Agency> {
  const teamId = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const code = `ARCA-${teamId.toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
  const id   = uuidv4()

  const res = await fetch(`${supabaseUrl()}/rest/v1/agencies`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ id, name, code, team_id: teamId, active: true }),
  })

  if (res.status === 409) throw new Error('Una agencia con ese nombre ya existe')
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)

  const rows: Agency[] = await res.json()
  return rows[0]
}

export async function toggleAgency(id: string, active: boolean): Promise<Agency> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/agencies?id=eq.${encodeURIComponent(id)}`,
    {
      method:  'PATCH',
      headers: headers(),
      body:    JSON.stringify({ active }),
    },
  )
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
  const rows: Agency[] = await res.json()
  return rows[0]
}

export async function deleteAgency(id: string): Promise<void> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/agencies?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: headers() },
  )
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
}

export async function findAgencyByCode(code: string): Promise<Agency | null> {
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/agencies?code=eq.${encodeURIComponent(code)}&active=eq.true&limit=1`,
    { headers: headers() },
  )
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
  const rows: Agency[] = await res.json()
  return rows[0] ?? null
}
