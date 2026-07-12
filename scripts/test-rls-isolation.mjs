#!/usr/bin/env node
// scripts/test-rls-isolation.mjs
//
// End-to-end check that Postgres RLS actually isolates one agency's
// documents from another's — using the real /api/activate flow (the same
// JWTs arca-app itself would receive) against the real deployed panel and
// the real Supabase project. Not a unit test: it hits live infrastructure.
//
// Usage: node scripts/test-rls-isolation.mjs
//
// Safe to re-run: every row it creates is deleted again at the end
// (by team_id), regardless of whether the tests passed or failed.

import { randomUUID } from 'node:crypto'

const PANEL_URL    = 'https://arca-silk.vercel.app'
const SUPABASE_URL = 'https://smfeildxsnsveaftptel.supabase.co'

const AGENCIES = {
  alpha: { code: 'ARCA-PRUEBA-ALPHA-C7DDE7', expectedTeamId: 'prueba-alpha' },
  beta:  { code: 'ARCA-PRUEBA-BETA-51E1B2',  expectedTeamId: 'prueba-beta' },
}

const results = []

function record(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

function abort(msg) {
  console.error(`\n❌ ABORTADO: ${msg}\n`)
  process.exit(1)
}

// ── /api/activate ─────────────────────────────────────────────────────────

async function activate(agencyKey) {
  const { code, expectedTeamId } = AGENCIES[agencyKey]

  let res
  try {
    res = await fetch(`${PANEL_URL}/api/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  } catch (err) {
    abort(`No se pudo conectar a ${PANEL_URL}/api/activate para activar "${agencyKey}": ${err.message}`)
  }

  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    abort(`/api/activate para "${agencyKey}" no devolvió JSON válido (status ${res.status}): ${text.slice(0, 300)}`)
  }

  if (!res.ok) {
    abort(`/api/activate para "${agencyKey}" devolvió ${res.status}: ${JSON.stringify(body)}`)
  }

  if (!body.supabaseKey) {
    abort(`/api/activate para "${agencyKey}" no trajo "supabaseKey" (el JWT firmado). Respuesta completa: ${JSON.stringify(body)}. Revisá SUPABASE_JWT_SECRET en Vercel.`)
  }

  if (!body.anonKey) {
    console.warn(`⚠️  "${agencyKey}": el campo "anonKey" vino vacío/ausente en la respuesta de /api/activate.`)
    console.warn(`   Esto probablemente significa que SUPABASE_ANON_KEY no está seteada (o está vacía) en las variables de entorno de Vercel.`)
    console.warn(`   Sigo la prueba usando el JWT también como "apikey" (funciona igual para este script), pero arca-app real necesita anonKey para el header apikey de PostgREST — corregilo en Vercel antes del piloto.\n`)
  }

  if (body.teamId !== expectedTeamId) {
    abort(`teamId devuelto para "${agencyKey}" ("${body.teamId}") no coincide con el esperado ("${expectedTeamId}") — ¿el código de activación es el correcto?`)
  }

  return {
    teamId: body.teamId,
    jwt:    body.supabaseKey,
    apikey: body.anonKey || body.supabaseKey,
  }
}

// ── PostgREST helper ──────────────────────────────────────────────────────

function headersFor(agency, extra = {}) {
  return {
    'Content-Type':  'application/json',
    'apikey':        agency.apikey,
    'Authorization': `Bearer ${agency.jwt}`,
    ...extra,
  }
}

async function rest(path, { method = 'GET', headers, body } = {}) {
  let res
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    return { networkError: true, status: null, ok: false, json: null, text: err.message }
  }

  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Not JSON — leave json null, text still has the raw body for reporting.
  }
  return { networkError: false, status: res.status, ok: res.ok, json, text }
}

function newDoc(teamId, suffix) {
  // Every NOT NULL column with no default must be present here, or
  // PostgREST rejects the insert before RLS even gets a chance to run —
  // which would masquerade as a false "isolation" pass/fail. Two sources:
  //
  // 1. arca-app/supabase/schema.sql (the tracked schema): id (plain TEXT
  //    primary key, no generated default — we must supply one), doc_type,
  //    description, file_name, team_id.
  // 2. `uploaded_by` — NOT NULL on the real live table, but it does not
  //    exist anywhere in schema.sql or any tracked migration. This is
  //    schema drift (see supabase/migrations/fix_uploaded_by_nullable.sql
  //    for the real fix, and the commit message for the full story) — the
  //    app itself never sends this column either, so until that migration
  //    is applied, every real save in team mode fails with the same error
  //    this script originally hit. Supplying a placeholder here keeps the
  //    RLS test itself unblocked regardless of whether that migration has
  //    been run yet.
  return {
    id:          randomUUID(),
    doc_type:    'Documento de prueba RLS',
    description: `Documento de prueba de aislamiento (${suffix})`,
    file_name:   `rls-test-${suffix}.txt`,
    team_id:     teamId,
    uploaded_by: 'test-rls-isolation-script',
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('== Activando agencias de prueba ==\n')
  const alpha = await activate('alpha')
  console.log(`   Alpha OK — team_id=${alpha.teamId}`)
  const beta = await activate('beta')
  console.log(`   Beta  OK — team_id=${beta.teamId}`)

  console.log('\n== Tests ==\n')

  // Test A — Alpha inserts its own document.
  const docAlpha = newDoc(alpha.teamId, 'alpha')
  const insA = await rest('documents', {
    method:  'POST',
    headers: headersFor(alpha, { Prefer: 'return=representation' }),
    body:    docAlpha,
  })
  record(
    'Test A — Alpha inserta su propio documento',
    insA.status === 201,
    insA.status === 201 ? `id ${docAlpha.id}` : `status ${insA.status}: ${insA.text}`
  )

  // Test B — Beta inserts its own document.
  const docBeta = newDoc(beta.teamId, 'beta')
  const insB = await rest('documents', {
    method:  'POST',
    headers: headersFor(beta, { Prefer: 'return=representation' }),
    body:    docBeta,
  })
  record(
    'Test B — Beta inserta su propio documento',
    insB.status === 201,
    insB.status === 201 ? `id ${docBeta.id}` : `status ${insB.status}: ${insB.text}`
  )

  // Test C — Alpha reads everything, must see zero rows belonging to Beta.
  const readAlpha = await rest('documents?select=id,team_id', { headers: headersFor(alpha) })
  const rowsAlpha = Array.isArray(readAlpha.json) ? readAlpha.json : null
  const leakedInAlpha = rowsAlpha ? rowsAlpha.filter(r => r.team_id !== alpha.teamId) : []
  record(
    'Test C — Alpha NO ve filas de Beta al leer todo',
    readAlpha.ok && rowsAlpha !== null && leakedInAlpha.length === 0,
    !readAlpha.ok
      ? `status ${readAlpha.status}: ${readAlpha.text}`
      : leakedInAlpha.length > 0
        ? `¡FUGA! ${leakedInAlpha.length} fila(s) ajenas visibles: ${JSON.stringify(leakedInAlpha)}`
        : `${rowsAlpha.length} fila(s) visibles, todas de "${alpha.teamId}"`
  )

  // Test D — Alpha tries to insert a row claiming Beta's team_id (spoofing).
  // RLS's WITH CHECK must reject this even though the request is otherwise
  // well-formed — this is the write-side half of isolation.
  const spoof = newDoc(beta.teamId, 'spoof-by-alpha')
  const insSpoof = await rest('documents', {
    method:  'POST',
    headers: headersFor(alpha, { Prefer: 'return=representation' }),
    body:    spoof,
  })
  record(
    'Test D — RLS bloquea a Alpha insertando con team_id de Beta',
    insSpoof.status !== 201,
    insSpoof.status === 201
      ? `¡RLS NO BLOQUEÓ LA SUPLANTACIÓN! Se insertó igual: ${JSON.stringify(insSpoof.json)}`
      : `status ${insSpoof.status} (rechazado correctamente): ${insSpoof.text}`
  )

  // Test E — reverse of Test C: Beta reads everything, must not see Alpha.
  const readBeta = await rest('documents?select=id,team_id', { headers: headersFor(beta) })
  const rowsBeta = Array.isArray(readBeta.json) ? readBeta.json : null
  const leakedInBeta = rowsBeta ? rowsBeta.filter(r => r.team_id !== beta.teamId) : []
  record(
    'Test E — Beta NO ve filas de Alpha al leer todo',
    readBeta.ok && rowsBeta !== null && leakedInBeta.length === 0,
    !readBeta.ok
      ? `status ${readBeta.status}: ${readBeta.text}`
      : leakedInBeta.length > 0
        ? `¡FUGA! ${leakedInBeta.length} fila(s) ajenas visibles: ${JSON.stringify(leakedInBeta)}`
        : `${rowsBeta.length} fila(s) visibles, todas de "${beta.teamId}"`
  )

  // ── Cleanup ────────────────────────────────────────────────────────────
  // Blanket-delete every row under either test team_id, regardless of which
  // test created it — these two team_ids only ever exist for this script.
  console.log('\n== Limpieza ==\n')
  const delAlpha = await rest(`documents?team_id=eq.${alpha.teamId}`, { method: 'DELETE', headers: headersFor(alpha) })
  console.log(`Borrado documentos de "${alpha.teamId}": status ${delAlpha.status}`)
  const delBeta = await rest(`documents?team_id=eq.${beta.teamId}`, { method: 'DELETE', headers: headersFor(beta) })
  console.log(`Borrado documentos de "${beta.teamId}": status ${delBeta.status}`)

  if (insSpoof.status === 201) {
    // If Test D actually failed (RLS broken), the spoofed row was created
    // with team_id = beta.teamId, so Beta's own delete above should already
    // have caught it — but try once more explicitly by id, just in case.
    const delSpoof = await rest(`documents?id=eq.${spoof.id}`, { method: 'DELETE', headers: headersFor(beta) })
    console.log(`Borrado de refuerzo del documento suplantado (id ${spoof.id}): status ${delSpoof.status}`)
  }

  // ── Verdict ────────────────────────────────────────────────────────────
  console.log('\n== Veredicto ==\n')
  const allPass = results.every(r => r.pass)
  if (allPass) {
    console.log('✅ AISLAMIENTO OK, LISTO PARA PILOTO')
  } else {
    console.log('❌ FALLO — NO USAR EN PRODUCCIÓN')
    console.log('\nTests fallidos:')
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  - ${r.name}: ${r.detail}`)
    }
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error('\n❌ Error inesperado ejecutando el script:', err)
  process.exit(1)
})
