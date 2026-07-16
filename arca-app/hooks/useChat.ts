'use client'

import { useState, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentMetadata } from '@/lib/openai'
import type { Document } from '@/lib/db'

export type MessageType = 'text' | 'metadata_card' | 'result_card' | 'loading'

export interface ChatMessage {
  id:        string
  role:      'user' | 'bot'
  content:   string
  type:      MessageType
  metadata?: DocumentMetadata
  results?:  Document[]
  timestamp: Date
}

interface ChatState {
  messages:        ChatMessage[]
  isProcessing:    boolean
  pendingMetadata: DocumentMetadata | null
  pendingFileData: {
    fileUrl?: string
    mimeType?: string
    rawContent?: string
    base64?: string
    filename?: string
  } | null
  awaitingClient: boolean
}

function makeMsg(
  role: 'user' | 'bot',
  content: string,
  type: MessageType = 'text',
  extra?: Partial<ChatMessage>
): ChatMessage {
  return { id: uuidv4(), role, content, type, timestamp: new Date(), ...extra }
}

function botMsg(
  content: string,
  type: MessageType = 'text',
  extra?: Partial<ChatMessage>
): ChatMessage {
  return makeMsg('bot', content, type, extra)
}

const HELP_TEXT = `Comandos que entiendo:

• Pegar un link → lo guardo automáticamente
• **"dame los links"** / **"ver todo"** → ver biblioteca
• **"links de [cliente]"** → filtrar por cliente
• **"los de hoy"** / **"los de ayer"** → por fecha
• **"cuántos"** / **"estadísticas"** → resumen
• **"abre [nombre]"** → abrir archivo
• **"copia el link de [nombre]"** → copiar link
• **"ayuda"** → mostrar este mensaje

Con Gemini activado (⚙ ajustes) también podés escribirme en lenguaje natural, p. ej. *"¿qué presupuestos tenemos del cliente Acme?"*`

// Helper to call electronAPI if available, then web fallback
async function openUrl(url: string) {
  const api = (window as Window & { electronAPI?: { openExternal?: (u: string) => Promise<void> } }).electronAPI
  if (api?.openExternal) {
    await api.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

async function copyUrl(url: string) {
  const api = (window as Window & { electronAPI?: { copyToClipboard?: (t: string) => Promise<void> } }).electronAPI
  if (api?.copyToClipboard) {
    await api.copyToClipboard(url)
  } else {
    await navigator.clipboard.writeText(url)
  }
}

export function useChat(opts?: {
  onDocSaved?: () => void
  onProcessingChange?: (v: boolean) => void
  onBotResponse?: (text: string) => void
  onShowLibrary?: (clientFilter?: string, docTypeFilter?: string) => void
  onShowStats?: () => void
}) {
  const onBotResponseRef = useRef(opts?.onBotResponse)
  onBotResponseRef.current = opts?.onBotResponse

  const [sentHistory, setSentHistory] = useState<string[]>([])
  const historyIndexRef = useRef(-1)

  const navigateHistory = useCallback((direction: 'up' | 'down'): string => {
    const history = sentHistory
    if (direction === 'up') {
      const next = Math.min(historyIndexRef.current + 1, history.length - 1)
      historyIndexRef.current = next
      return next >= 0 ? (history[next] ?? '') : ''
    } else {
      const next = Math.max(historyIndexRef.current - 1, -1)
      historyIndexRef.current = next
      return next < 0 ? '' : (history[next] ?? '')
    }
  }, [sentHistory])

  const [state, setState] = useState<ChatState>({
    messages: [botMsg('Hola. ¿Qué guardamos o qué buscamos?')],
    isProcessing:    false,
    pendingMetadata: null,
    pendingFileData: null,
    awaitingClient:  false,
  })

  const replaceLastBotMsg = useCallback((msg: ChatMessage) => {
    setState((s) => {
      const msgs = [...s.messages]
      const idx  = msgs.findLastIndex((m) => m.role === 'bot' && m.type === 'loading')
      if (idx >= 0) msgs[idx] = msg
      else msgs.push(msg)
      return { ...s, messages: msgs }
    })
    if (msg.type !== 'loading') {
      onBotResponseRef.current?.(msg.content)
    }
  }, [])

  // ── Confirm save ──────────────────────────────────────────────────────────
  const confirmSave = useCallback(async () => {
    if (!state.pendingMetadata || !state.pendingFileData) return

    replaceLastBotMsg(botMsg('Guardando...', 'loading'))

    try {
      const res  = await fetch('/api/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          confirmedMetadata: state.pendingMetadata,
          fileUrl:           state.pendingFileData.fileUrl,
          mimeType:          state.pendingFileData.mimeType,
          file:              state.pendingFileData.base64,
          filename:          state.pendingFileData.filename,
          rawContent:        state.pendingFileData.rawContent ?? '',
          confirmed:         true,
        }),
      })
      const data = await res.json()

      if (data.saved) {
        replaceLastBotMsg(
          botMsg(`✓ Guardado — ${state.pendingMetadata.doc_type}${state.pendingMetadata.client_name ? ` · ${state.pendingMetadata.client_name}` : ''}.`)
        )
        setState((s) => ({
          ...s,
          isProcessing:    false,
          pendingMetadata: null,
          pendingFileData: null,
          awaitingClient:  false,
        }))
        opts?.onDocSaved?.()
      } else {
        replaceLastBotMsg(botMsg(`Error al guardar: ${data.error ?? 'intenta de nuevo'}`))
        setState((s) => ({ ...s, isProcessing: false }))
      }
    } catch {
      replaceLastBotMsg(botMsg('Algo salió mal al guardar. Intenta de nuevo.'))
      setState((s) => ({ ...s, isProcessing: false }))
    }
  }, [state.pendingMetadata, state.pendingFileData, replaceLastBotMsg, opts])

  // ── Handle URL ────────────────────────────────────────────────────────────
  const handleUrl = useCallback(async (url: string) => {
    replaceLastBotMsg(botMsg('Leyendo el link...', 'loading'))

    try {
      const res  = await fetch('/api/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      })
      const data = await res.json()

      if (data.duplicate) {
        const d = data.existingDocument
        replaceLastBotMsg(botMsg(`Ya tenía ese link guardado como "${d.file_name}".`))
        setState((s) => ({ ...s, isProcessing: false }))
        return
      }

      if (data.needsClient) {
        setState((s) => ({
          ...s,
          isProcessing:    false,
          pendingMetadata: data.partialMetadata,
          pendingFileData: { fileUrl: url, rawContent: data.rawContent ?? '' },
          awaitingClient:  true,
        }))
        replaceLastBotMsg(botMsg('¿De qué cliente es este link?'))
        return
      }

      if (data.proposedMetadata) {
        setState((s) => ({
          ...s,
          isProcessing:    false,
          pendingMetadata: data.proposedMetadata,
          pendingFileData: { fileUrl: url, rawContent: data.rawContent ?? '' },
        }))
        replaceLastBotMsg(
          botMsg('¿Todo bien o cambiamos algo?', 'metadata_card', { metadata: data.proposedMetadata })
        )
        return
      }

      if (!res.ok || data.error) {
        replaceLastBotMsg(botMsg(`No pude procesar ese link: ${data.error ?? 'intenta de nuevo'}`))
        setState((s) => ({ ...s, isProcessing: false }))
      }
    } catch {
      replaceLastBotMsg(botMsg('No pude procesar ese link. Intenta de nuevo.'))
      setState((s) => ({ ...s, isProcessing: false }))
    }
  }, [replaceLastBotMsg])

  // ── Handle text commands ──────────────────────────────────────────────────
  const handleTextCommand = useCallback(async (text: string, hasLoadingMsg = false) => {
    const lower = text.toLowerCase()

    // Helper: push bot message (replaces loading if present, otherwise appends)
    const addBotMsg = (msg: ChatMessage) => {
      if (hasLoadingMsg) {
        replaceLastBotMsg(msg)
      } else {
        setState((s) => ({ ...s, messages: [...s.messages, msg] }))
        if (msg.type !== 'loading') {
          onBotResponseRef.current?.(msg.content)
        }
      }
    }

    // ── ayuda ─────────────────────────────────────────────────────────────
    if (/ayuda|comandos|qué puedes|cómo funciona/i.test(lower)) {
      addBotMsg(botMsg(HELP_TEXT))
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── listAll ───────────────────────────────────────────────────────────
    if (/dame los links|muéstrame todo|ver todo|listar todo|mostrar todo|todos los doc|^lista$|^listar$/i.test(lower)) {
      const res  = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ listAll: true }),
      })
      const data = await res.json()
      if (data.results?.length) {
        addBotMsg(
          botMsg(`Aquí tienes los últimos ${data.results.length} links:`, 'result_card', { results: data.results })
        )
      } else {
        addBotMsg(botMsg('No hay nada guardado aún.'))
      }
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── list_today ────────────────────────────────────────────────────────
    if (/(?:qué (?:guardamos|subimos)|archivos|documentos|links) de hoy|^hoy$|guardé hoy|los de hoy/i.test(lower)) {
      const res  = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ listToday: true }),
      })
      const data = await res.json()
      if (data.results?.length) {
        addBotMsg(
          botMsg(`Hoy guardamos ${data.results.length} archivo${data.results.length > 1 ? 's' : ''}:`, 'result_card', { results: data.results })
        )
      } else {
        addBotMsg(botMsg('Hoy no guardamos nada todavía.'))
      }
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── list_yesterday ────────────────────────────────────────────────────
    if (/(?:qué (?:guardamos|subimos)|archivos|documentos|links) de ayer|^ayer$|los de ayer/i.test(lower)) {
      const res  = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ listYesterday: true }),
      })
      const data = await res.json()
      if (data.results?.length) {
        addBotMsg(
          botMsg(`Ayer guardamos ${data.results.length} archivo${data.results.length > 1 ? 's' : ''}:`, 'result_card', { results: data.results })
        )
      } else {
        addBotMsg(botMsg('Ayer no guardamos nada.'))
      }
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── count ─────────────────────────────────────────────────────────────
    if (/cuántos|cuantos/i.test(lower)) {
      const clientMatch = lower.match(/(?:tiene|de|para)\s+(.+)$/)
      const clientFilter = clientMatch?.[1]?.trim()
      const res  = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ countOnly: true, clientFilter }),
      })
      const data = await res.json()
      if (clientFilter) {
        addBotMsg(botMsg(`${data.count ?? 0} archivo${data.count !== 1 ? 's' : ''} de ${clientFilter}.`))
      } else {
        addBotMsg(botMsg(`Tienen ${data.count ?? 0} archivo${data.count !== 1 ? 's' : ''} guardados en ARCA.`))
      }
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── open ──────────────────────────────────────────────────────────────
    if (/^(abre|ábreme|abrí|muéstrame)\b/i.test(lower)) {
      const query = text.replace(/^(abre|ábreme|abrí|muéstrame)\s*/i, '').trim()
      const res   = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      })
      const data = await res.json()
      if (data.results?.length === 1 && data.results[0].file_url) {
        const doc = data.results[0]
        await openUrl(doc.file_url)
        addBotMsg(botMsg(`Abriendo "${doc.file_name}" ↗`))
      } else if (data.results?.length > 1) {
        addBotMsg(
          botMsg('Encontré varios. ¿Cuál querés abrir?', 'result_card', { results: data.results })
        )
      } else {
        addBotMsg(botMsg('No encontré ese archivo. ¿Me das más pistas?'))
      }
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── share ─────────────────────────────────────────────────────────────
    if (/^(comparte|copia el link|dame el link|compartí|copia)\b/i.test(lower)) {
      const query = text.replace(/^(comparte|copia el link de|dame el link de|compartí|copia)\s*/i, '').trim()
      const res   = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      })
      const data = await res.json()
      if (data.results?.length && data.results[0].file_url) {
        const doc = data.results[0]
        await copyUrl(doc.file_url)
        addBotMsg(
          botMsg(`✓ Link copiado al portapapeles\n${doc.file_name}${doc.client_name ? ` — ${doc.client_name}` : ''}`)
        )
      } else if (data.results?.length > 1) {
        addBotMsg(
          botMsg('Encontré varios. ¿De cuál querés el link?', 'result_card', { results: data.results })
        )
      } else {
        addBotMsg(botMsg('No encontré ese archivo. ¿Me das más pistas?'))
      }
      setState((s) => ({ ...s, isProcessing: false }))
      return
    }

    // ── estadísticas / stats ──────────────────────────────────────────────
    if (/estadísticas|stats|resumen general|^resumen$|^stats$/i.test(lower)) {
      opts?.onShowStats?.()
      addBotMsg(botMsg('Abriendo...'))
      setState(s => ({ ...s, isProcessing: false }))
      return
    }

    // ── ver todo / biblioteca ─────────────────────────────────────────────
    if (/^(ver todo|muéstrame todo|lista todo|todos los links|biblioteca|ver biblioteca|links)$/i.test(lower)) {
      opts?.onShowLibrary?.()
      addBotMsg(botMsg('Abriendo...'))
      setState(s => ({ ...s, isProcessing: false }))
      return
    }

    // ── todo de [cliente] / links de [cliente] ────────────────────────────
    const todoDeMatch = lower.match(/^(?:todo de|links de|documentos de|archivos de|los de|dame los de|del cliente|para)\s+(.+)$/i)
    if (todoDeMatch) {
      const term = todoDeMatch[1].trim()

      // Try client filter first
      const clientRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientFilter: term }),
      })
      const clientData = await clientRes.json()

      if (clientData.results?.length > 0) {
        addBotMsg(botMsg(`${clientData.results.length} link${clientData.results.length > 1 ? 's' : ''} de ${term}:`, 'result_card', { results: clientData.results }))
      } else {
        // Fallback: general text search for the term
        const searchRes = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: term }),
        })
        const searchData = await searchRes.json()
        if (searchData.results?.length > 0) {
          addBotMsg(botMsg(`${searchData.results.length} link${searchData.results.length > 1 ? 's' : ''} relacionados con "${term}":`, 'result_card', { results: searchData.results }))
        } else {
          addBotMsg(botMsg(`No hay nada guardado de '${term}' todavía.`))
        }
      }
      setState(s => ({ ...s, isProcessing: false }))
      return
    }

    // ── todos los [tipo] / muéstrame los [tipo] ───────────────────────────
    const todosLosMatch = lower.match(/^(?:todos los|muéstrame los|ver los|los|briefs|reportes|contratos)\s+(.+)$/i)
    if (todosLosMatch) {
      const docType = todosLosMatch[1].trim()
      opts?.onShowLibrary?.(undefined, docType)
      addBotMsg(botMsg('Abriendo...'))
      setState(s => ({ ...s, isProcessing: false }))
      return
    }

    // ── eliminar (informativo) ────────────────────────────────────────────
    if (/^(eliminar|borrar|borra|elimina)\b/i.test(lower)) {
      addBotMsg(botMsg('Para eliminar, abre la biblioteca (di "ver todo") y usa el botón Eliminar en la tarjeta.'))
      setState(s => ({ ...s, isProcessing: false }))
      return
    }

    // ── editar (informativo) ──────────────────────────────────────────────
    if (/^(editar|cambiar|modifica|cambia)\b/i.test(lower)) {
      addBotMsg(botMsg('Para editar, abre la biblioteca (di "ver todo") y usa el botón Editar en la tarjeta.'))
      setState(s => ({ ...s, isProcessing: false }))
      return
    }

    // ── Asistente IA (Gemini) — lenguaje natural ──────────────────────────
    // Solo llega acá lo que ningún comando rápido reconoció. Si hay una key
    // configurada, el servidor interpreta el mensaje y ejecuta la acción;
    // handled:false (sin key, sin internet, error de Gemini) sigue con el
    // pipeline local de siempre.
    try {
      addBotMsg(botMsg('Pensando...', 'loading'))
      const aiRes = await fetch('/api/assistant', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: text }),
      })
      const ai = await aiRes.json()
      if (ai.handled) {
        if (ai.ui === 'help') {
          replaceLastBotMsg(botMsg(HELP_TEXT))
        } else if (ai.ui === 'stats') {
          opts?.onShowStats?.()
          replaceLastBotMsg(botMsg(ai.message ?? 'Abriendo...'))
        } else if (ai.ui === 'library') {
          opts?.onShowLibrary?.(ai.clientFilter, ai.docTypeFilter)
          replaceLastBotMsg(botMsg(ai.message ?? 'Abriendo...'))
        } else {
          if (ai.openUrl) await openUrl(ai.openUrl)
          replaceLastBotMsg(
            ai.results?.length
              ? botMsg(ai.message ?? '', 'result_card', { results: ai.results })
              : botMsg(ai.message ?? 'Listo.')
          )
        }
        setState((s) => ({ ...s, isProcessing: false }))
        return
      }
      // No lo manejó la IA → quitar el "Pensando..." y seguir en local.
      setState((s) => ({ ...s, messages: s.messages.filter((m) => m.type !== 'loading') }))
    } catch {
      setState((s) => ({ ...s, messages: s.messages.filter((m) => m.type !== 'loading') }))
    }

    // ── list by client ────────────────────────────────────────────────────
    const clientMatch = lower.match(/documentos de (.+)/i)
    const clientFilter = clientMatch?.[1]

    // Strip filler words to extract the meaningful search term
    const FILLERS = /\b(dame|muéstrame|muestrame|tienes|hay|algo|de|del|la|las|los|el|un|una|oye|arca|busca|buscar|ver|tengo|quiero|puedes|puedo|encontrar|links?|archivos?|documentos?)\b/gi
    const cleanQuery = text.replace(FILLERS, ' ').replace(/\s+/g, ' ').trim()
    const searchTerm = cleanQuery || text.trim()

    // ── General search ────────────────────────────────────────────────────
    const res  = await fetch('/api/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: searchTerm, clientFilter }),
    })
    const data = await res.json()

    if (data.results?.length) {
      const n = data.results.length
      addBotMsg(
        botMsg(`Aquí tienes ${n} link${n > 1 ? 's' : ''}:`, 'result_card', { results: data.results })
      )
    } else {
      const q = text.trim()
      addBotMsg(botMsg(`No encontré nada de '${q}'. ¿Probás con otro término?`))
    }
    setState((s) => ({ ...s, isProcessing: false }))
  }, [replaceLastBotMsg, opts])

  // ── sendMessage (main entry point) ────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return

    const userMsg    = makeMsg('user', text.trim())
    const loadingMsg = botMsg('...', 'loading')

    setSentHistory((prev) => [text.trim(), ...prev].slice(0, 5))
    historyIndexRef.current = -1

    try {
      // ── awaitingClient: instant, no loading ──────────────────────────────
      if (state.awaitingClient && state.pendingMetadata && state.pendingFileData) {
        setState((s) => ({ ...s, messages: [...s.messages, userMsg] }))
        const updated = { ...state.pendingMetadata, client_name: text.trim() }
        setState((s) => ({
          ...s,
          messages:        [...s.messages, botMsg('¿Todo bien o cambiamos algo?', 'metadata_card', { metadata: updated })],
          isProcessing:    false,
          pendingMetadata: updated,
          awaitingClient:  false,
        }))
        opts?.onProcessingChange?.(false)
        return
      }

      const urlMatch  = text.match(/https?:\/\/[^\s]+/)
      const isConfirm = /^(sí|si|dale|ok|okay|guardar|confirmar|listo|adelante|yes)$/i.test(text.trim())

      // ── URL or confirm: needs loading state ──────────────────────────────
      if (urlMatch || (isConfirm && state.pendingMetadata && state.pendingFileData)) {
        setState((s) => ({
          ...s,
          messages:     [...s.messages, userMsg, loadingMsg],
          isProcessing: true,
        }))

        if (urlMatch) {
          const cleanUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '')
          await handleUrl(cleanUrl)
        } else {
          await confirmSave()
        }
        return
      }

      // ── Pure text command: no loading state, no spinner ──────────────────
      setState((s) => ({ ...s, messages: [...s.messages, userMsg] }))
      await handleTextCommand(text, false)
    } catch {
      replaceLastBotMsg(botMsg('Algo salió mal. Intenta de nuevo.'))
      setState((s) => ({ ...s, isProcessing: false }))
      opts?.onProcessingChange?.(false)
    }
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [state.awaitingClient, state.pendingMetadata, state.pendingFileData, confirmSave, handleUrl, handleTextCommand, replaceLastBotMsg])

  // ── handleFile ────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]

      setState((s) => ({
        ...s,
        messages:     [...s.messages, makeMsg('user', `🔎 ${file.name}`), botMsg('Analizando archivo...', 'loading')],
        isProcessing: true,
      }))

      try {
        const uploadRes = await fetch('/api/upload', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ base64, filename: file.name, mimeType: file.type }),
        })
        const { url: fileUrl } = await uploadRes.json()

        const res  = await fetch('/api/save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ file: base64, filename: file.name, mimeType: file.type, fileUrl }),
        })
        const data = await res.json()

        if (data.needsClient) {
          setState((s) => ({
            ...s,
            isProcessing:    false,
            pendingMetadata: data.partialMetadata,
            pendingFileData: { fileUrl, mimeType: file.type, filename: file.name, base64 },
            awaitingClient:  true,
          }))
          replaceLastBotMsg(botMsg('¿A qué cliente pertenece este archivo?'))
          opts?.onProcessingChange?.(false)
          return
        }

        if (data.proposedMetadata) {
          setState((s) => ({
            ...s,
            isProcessing:    false,
            pendingMetadata: data.proposedMetadata,
            pendingFileData: { fileUrl, mimeType: file.type, filename: file.name, base64 },
          }))
          replaceLastBotMsg(
            botMsg('¿Todo bien o cambiamos algo?', 'metadata_card', { metadata: data.proposedMetadata })
          )
          opts?.onProcessingChange?.(false)
          return
        }

        replaceLastBotMsg(botMsg('Listo, guardado ✓'))
        setState((s) => ({ ...s, isProcessing: false }))
        opts?.onProcessingChange?.(false)
        opts?.onDocSaved?.()
      } catch {
        replaceLastBotMsg(botMsg('Algo salió mal con el archivo. Intenta de nuevo.'))
        setState((s) => ({ ...s, isProcessing: false }))
        opts?.onProcessingChange?.(false)
      }
    }
  }, [replaceLastBotMsg, opts])

  const updatePendingClient = useCallback((clientName: string) => {
    setState((s) => ({
      ...s,
      pendingMetadata: s.pendingMetadata ? { ...s.pendingMetadata, client_name: clientName } : null,
    }))
  }, [])

  return {
    messages:        state.messages,
    isProcessing:    state.isProcessing,
    pendingMetadata: state.pendingMetadata,
    awaitingClient:  state.awaitingClient,
    sendMessage,
    handleFile,
    confirmSave,
    updatePendingClient,
    sentHistory,
    navigateHistory,
  }
}
