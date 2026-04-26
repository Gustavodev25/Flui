import { useRef, useState } from 'react'
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Minus, Code, Image, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/api'

interface ChangelogEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function ChangelogEditor({ value, onChange, placeholder }: ChangelogEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [aiFormatting, setAiFormatting] = useState(false)
  const [aiHint, setAiHint] = useState<'paste' | null>(null)
  const [aiError, setAiError] = useState(false)

  function insertAtCursor(before: string, after = '', defaultText = '') {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || defaultText
    const newValue = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(newValue)
    setTimeout(() => {
      el.focus()
      const newPos = start + before.length + selected.length + after.length
      el.setSelectionRange(newPos, newPos)
    }, 0)
  }

  function insertLinePrefix(prefix: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart)
    onChange(newValue)
    setTimeout(() => {
      el.focus()
      const newPos = start + prefix.length
      el.setSelectionRange(newPos, newPos)
    }, 0)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    const ext = file.name.split('.').pop()
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('changelog-images').upload(path, file, { upsert: false })
    if (error) {
      console.error('Erro ao fazer upload da imagem:', error)
      setUploadingImage(false)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('changelog-images').getPublicUrl(path)
    const el = textareaRef.current
    const pos = el ? el.selectionStart : value.length
    const before = value.slice(0, pos)
    const after = value.slice(pos)
    onChange(before + `\n![imagem](${publicUrl})\n` + after)
    setUploadingImage(false)
    e.target.value = ''
  }

  async function formatWithAI(text: string) {
    if (!text.trim() || aiFormatting) return
    setAiFormatting(true)
    setAiHint(null)
    setAiError(false)
    try {
      const { formatted } = await apiFetch<{ formatted: string }>('/api/admin/changelog/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      onChange(formatted)
    } catch {
      setAiError(true)
    } finally {
      setAiFormatting(false)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData('text')
    // Só mostra o hint se colou texto substancial (>80 chars) sem markdown
    if (pasted.length > 80 && !pasted.includes('**') && !pasted.includes('##') && !pasted.includes('- ')) {
      // Deixa o paste acontecer normalmente, depois mostra o hint
      setTimeout(() => setAiHint('paste'), 100)
    }
  }

  const toolbarButtons = [
    { icon: <Bold size={13} />, title: 'Negrito', action: () => insertAtCursor('**', '**', 'texto') },
    { icon: <Italic size={13} />, title: 'Itálico', action: () => insertAtCursor('*', '*', 'texto') },
    null,
    { icon: <Heading2 size={13} />, title: 'Título (H2)', action: () => insertLinePrefix('## ') },
    { icon: <Heading3 size={13} />, title: 'Subtítulo (H3)', action: () => insertLinePrefix('### ') },
    null,
    { icon: <List size={13} />, title: 'Lista com marcadores', action: () => insertLinePrefix('- ') },
    { icon: <ListOrdered size={13} />, title: 'Lista numerada', action: () => insertLinePrefix('1. ') },
    null,
    { icon: <Code size={13} />, title: 'Código inline', action: () => insertAtCursor('`', '`', 'código') },
    { icon: <Minus size={13} />, title: 'Divisor', action: () => insertAtCursor('\n\n---\n\n', '', '') },
  ]

  return (
    <div className="border border-[#e9e9e7] rounded-xl overflow-hidden focus-within:border-[#202020] focus-within:ring-1 focus-within:ring-[#202020] transition-all bg-[#f7f7f5]">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[#e9e9e7] bg-white/70 flex-wrap">
        {toolbarButtons.map((btn, i) =>
          btn === null ? (
            <div key={i} className="w-px h-4 bg-[#e9e9e7] mx-1" />
          ) : (
            <button
              key={i}
              type="button"
              onClick={btn.action}
              title={btn.title}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[#37352f]/40 hover:text-[#202020] hover:bg-[#f0f0ee] transition-all"
            >
              {btn.icon}
            </button>
          )
        )}

        <div className="w-px h-4 bg-[#e9e9e7] mx-1" />

        {/* Imagem */}
        <label
          className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${uploadingImage ? 'text-[#37352f]/20 cursor-not-allowed' : 'text-[#37352f]/40 hover:text-[#202020] hover:bg-[#f0f0ee] cursor-pointer'}`}
          title="Inserir imagem"
        >
          {uploadingImage ? <Loader2 size={13} className="animate-spin" /> : <Image size={13} />}
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
        </label>

        <div className="w-px h-4 bg-[#e9e9e7] mx-1" />

        {/* Botão IA */}
        <button
          type="button"
          onClick={() => formatWithAI(value)}
          disabled={aiFormatting || !value.trim()}
          title="Formatar com IA"
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[10px] font-bold transition-all ${
            aiFormatting || !value.trim()
              ? 'text-[#37352f]/20 cursor-not-allowed'
              : 'text-purple-500 hover:bg-purple-50 hover:text-purple-600'
          }`}
        >
          {aiFormatting
            ? <Loader2 size={12} className="animate-spin" />
            : <Sparkles size={12} />
          }
          {aiFormatting ? 'Formatando...' : 'IA'}
        </button>
      </div>

      {/* Erro da IA */}
      {aiError && (
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-[#fafafa] border-b border-[#e9e9e7]">
          <span className="text-[11px] text-[#37352f]/40">
            IA indisponível — tente novamente em instantes.
          </span>
          <button
            type="button"
            onClick={() => { setAiError(false); formatWithAI(value) }}
            className="text-[10px] font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Hint pós-paste */}
      {aiHint === 'paste' && (
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-[#fafafa] border-b border-[#e9e9e7]">
          <span className="text-[11px] text-[#37352f]/40 flex items-center gap-1.5">
            <Sparkles size={10} />
            Formatar com IA?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => formatWithAI(value)}
              className="text-[10px] font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors"
            >
              Formatar
            </button>
            <button
              type="button"
              onClick={() => setAiHint(null)}
              className="text-[10px] text-[#37352f]/25 hover:text-[#37352f]/50 transition-colors"
            >
              Ignorar
            </button>
          </div>
        </div>
      )}

      {/* Editor */}
      <textarea
        ref={textareaRef}
        placeholder={placeholder || 'Descreva a atualização em detalhes...\n\n## Use títulos para organizar\n- Liste as novidades\n**Destaque** o que for importante'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onPaste={handlePaste}
        rows={8}
        className="w-full bg-transparent px-4 py-3 text-sm text-[#37352f] placeholder:text-[#37352f]/25 focus:outline-none resize-none font-mono leading-relaxed"
      />

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#e9e9e7] bg-white/40 flex items-center justify-between">
        <span className="text-[10px] text-[#37352f]/25 font-medium">
          Markdown — **negrito**, *itálico*, ## título, - lista
        </span>
        <span className="text-[10px] text-[#37352f]/20 font-mono">{value.length} chars</span>
      </div>
    </div>
  )
}
