import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUpRight, Building2, FileText, Globe2, Library, LoaderCircle, Search, X } from 'lucide-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'

interface Benchmark {
  id: string
  name: string
  category: string
  source?: string
}

export interface SearchWorkspace {
  catalog: Benchmark[]
  loading: Promise<unknown> | null
  loadFailed: boolean
  loadCatalog(): Promise<void>
  searchTrigger?: Element | null
  renderSearch(): void
  isSearchOpen?: () => boolean
}

interface ResearchItem {
  id: string
  title: string
  status: string
  tags: string[]
  notes: string
}

interface SearchRuntime {
  BenchmarkDetail?: { open(id: string, trigger?: Element | null): unknown }
  ResearchWorkspace?: {
    getSearchItems(): ResearchItem[]
    focusEntry(id: string): unknown
  }
}

const installed = new WeakSet<SearchWorkspace>()
const categoryNames: Record<string, string> = {
  energy: 'Energy', metal: 'Metals', precious: 'Precious metals',
  agricultural: 'Agriculture', index: 'Indices',
}
const navigation = [
  { title: 'Country data', description: 'Browse country reference data', href: '/data', icon: Globe2 },
  { title: 'Companies', description: 'Explore company filings', href: '/companies', icon: Building2 },
  { title: 'Sources', description: 'Review benchmark data sources', href: '/sources', icon: Library },
]

const runtime = () => (window as Window & { BW?: SearchRuntime }).BW
const ordinaryClick = (event: React.MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

function anotherModalOpen() {
  if (document.body.classList.contains('bw-detail-open')) return true
  return Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [role="alertdialog"]'))
    .some(element => element.id !== 'bw-search-dialog' && !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' && element.getAttribute('data-state') !== 'closed' &&
      element.getClientRects().length > 0)
}

/** Mount once; retain the legacy catalog loader and its existing public endpoint. */
export function installWorkspaceSearch(workspace: SearchWorkspace): boolean {
  if (installed.has(workspace)) return true
  const fallback = document.getElementById('bw-search-dialog')
  const trigger = document.getElementById('bw-search-trigger')
  if (!fallback || !trigger) return false

  const host = document.createElement('div')
  host.className = 'reui style-nova rui-search-host'
  host.id = 'bw-reui-search-root'
  fallback.replaceWith(host)
  installed.add(workspace)

  let open = false
  let query = ''
  let revision = 0
  let afterClose: (() => void) | null = null
  const subscribers = new Set<() => void>()
  const notify = () => { revision += 1; subscribers.forEach(listener => listener()) }
  const subscribe = (listener: () => void) => {
    subscribers.add(listener)
    return () => { subscribers.delete(listener) }
  }
  const snapshot = () => revision
  const focusOpener = () => {
    const opener = workspace.searchTrigger
    if (opener instanceof HTMLElement && opener.isConnected && !anotherModalOpen()) {
      opener.focus({ preventScroll: true })
    }
  }
  const close = (action?: () => void) => {
    if (!open) return
    afterClose = action || null
    open = false
    trigger.setAttribute('aria-expanded', 'false')
    notify()
  }
  const load = () => {
    const pending = workspace.loadCatalog()
    notify()
    // The legacy loader handles failures, while this also supports a rejecting loader.
    void Promise.resolve(pending).catch(() => { workspace.loadFailed = true }).finally(notify)
  }
  const show = () => {
    if (open || afterClose || anotherModalOpen()) return
    workspace.searchTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : trigger
    query = ''
    open = true
    trigger.setAttribute('aria-expanded', 'true')
    notify()
    load()
  }
  const openBenchmark = (benchmark: Benchmark) => {
    close(() => {
      const detail = runtime()?.BenchmarkDetail
      if (detail) detail.open(benchmark.id, workspace.searchTrigger || trigger)
      else window.location.assign('/commodity/' + encodeURIComponent(benchmark.id))
    })
  }
  const openResearch = (entry: ResearchItem) => {
    close(() => {
      const research = runtime()?.ResearchWorkspace
      if (document.getElementById('research-workspace') && research) {
        // The native research editor captures this as its own return-focus target.
        focusOpener()
        research.focusEntry(entry.id)
      } else window.location.assign('/?workspace=research&entry=' + encodeURIComponent(entry.id))
    })
  }
  const setQuery = (value: string) => { query = value; notify() }
  workspace.renderSearch = notify
  workspace.isSearchOpen = () => open
  trigger.setAttribute('aria-expanded', 'false')
  const shortcut = document.getElementById('bw-search-shortcut')
  if (shortcut) shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
  trigger.addEventListener('click', show)
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.repeat || event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    if (open) { event.preventDefault(); close() }
    else if (!anotherModalOpen()) { event.preventDefault(); show() }
  })

  function SearchDialog() {
    React.useSyncExternalStore(subscribe, snapshot, snapshot)
    const input = React.useRef<HTMLInputElement>(null)
    const normalized = query.trim().toLocaleLowerCase()
    const matches = (text: string) => text.toLocaleLowerCase().includes(normalized)
    const benchmarks = workspace.catalog.filter(item => matches([item.name, item.category, item.id, item.source].join(' ')))
    const research = open ? (runtime()?.ResearchWorkspace?.getSearchItems() || []).filter(item =>
      matches([item.title, item.status, ...item.tags, item.notes].join(' '))) : []
    const links = navigation.filter(item => matches([item.title, item.description].join(' ')))
    const resultCount = benchmarks.length + research.length + links.length
    const clearQuery = () => { setQuery(''); input.current?.focus() }

    return (
      <Dialog open={open} onOpenChange={next => { if (!next) close() }}>
        <DialogContent
          id="bw-search-dialog"
          className="rui-search-dialog"
          showCloseButton={false}
          onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus() }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            const action = afterClose
            afterClose = null
            // Wait until the Radix focus trap and inert background have been removed.
            window.requestAnimationFrame(() => { if (!open) { if (action) action(); else focusOpener() } })
          }}
          style={{ width: 'min(600px, calc(100vw - 32px))', padding: 0, overflow: 'hidden' }}
        >
          <div className="rui-search-heading">
            <DialogTitle className="rui-search-title">Search workspace</DialogTitle>
            <DialogDescription className="sr-only">
              Search benchmarks, sources, and your private research. Use the arrow keys to choose a result and Enter to open it.
            </DialogDescription>
            <Button id="bw-search-close" type="button" variant="ghost" size="icon-sm" aria-label="Close search" onClick={() => close()}>
              <X aria-hidden="true" size={16} />
            </Button>
          </div>
          <Command shouldFilter={false} loop label="Search benchmarks and research" className="rui-search-command">
            <div className="rui-search-input-row">
              <CommandInput
                ref={input}
                data-workspace-search-input=""
                aria-label="Search benchmarks and research"
                value={query}
                onValueChange={setQuery}
                placeholder="Search benchmarks, sources, or your notes…"
                autoComplete="off"
                spellCheck={false}
              />
              {query && <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear search" onClick={clearQuery}><X aria-hidden="true" size={14} /></Button>}
            </div>
            <p id="bw-search-status" className="rui-search-status" role="status" aria-live="polite" aria-atomic="true">
              {benchmarks.length} benchmarks · {research.length} research {research.length === 1 ? 'entry' : 'entries'}
              {workspace.loading && <span className="rui-search-loading"><LoaderCircle aria-hidden="true" size={12} className="animate-spin" /> Loading all benchmarks…</span>}
            </p>
            {workspace.loadFailed && <div className="rui-search-error" role="status"><span>Some benchmarks could not load.</span><Button type="button" variant="outline" size="sm" onClick={load} disabled={Boolean(workspace.loading)}>Retry</Button></div>}
            <CommandList data-workspace-search-results="" className="rui-search-results" style={{ maxHeight: 'min(70dvh, 480px)', overflowY: 'auto' }}>
              {!workspace.loading && resultCount === 0 && <CommandEmpty className="rui-search-empty">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><Search aria-hidden="true" size={20} /></EmptyMedia>
                    <EmptyTitle>No results found</EmptyTitle>
                    <EmptyDescription>Try a benchmark name, source, or a word from your notes.</EmptyDescription>
                  </EmptyHeader>
                  <Button type="button" variant="outline" size="sm" onClick={clearQuery}>Clear search</Button>
                </Empty>
              </CommandEmpty>}
              {benchmarks.length > 0 && <CommandGroup heading="Benchmarks" className="rui-search-group">
                {benchmarks.slice(0, 30).map(item => <CommandItem
                  asChild
                  key={'benchmark:' + item.id}
                  value={'benchmark:' + item.id}
                  className="rui-search-item"
                  onSelect={() => openBenchmark(item)}
                  onClickCapture={event => { if (!ordinaryClick(event)) event.stopPropagation() }}
                >
                  <a className="rui-search-link" href={'/commodity/' + encodeURIComponent(item.id)} tabIndex={-1} onClick={event => { if (ordinaryClick(event)) event.preventDefault() }}>
                    <span className="rui-search-result-copy"><span className="rui-search-result-name">{item.name}</span><span className="rui-search-result-meta">{[categoryNames[item.category] || item.category, item.source].filter(Boolean).join(' · ')}</span></span>
                    <ArrowUpRight aria-hidden="true" size={14} />
                  </a>
                </CommandItem>)}
              </CommandGroup>}
              {research.length > 0 && <CommandGroup heading="Your research" className="rui-search-group">
                {research.slice(0, 20).map(item => <CommandItem key={'research:' + item.id} value={'research:' + item.id} className="rui-search-item" onSelect={() => openResearch(item)}>
                  <FileText aria-hidden="true" size={15} />
                  <span className="rui-search-result-copy"><span className="rui-search-result-name">{item.title || 'Untitled entry'}</span><span className="rui-search-result-meta">{item.status || 'Research entry'}</span></span>
                  <Badge variant="outline">Private</Badge>
                </CommandItem>)}
              </CommandGroup>}
              {links.length > 0 && <CommandGroup heading="Navigation" className="rui-search-group">
                {links.map(item => <CommandItem asChild key={item.href} value={'navigation:' + item.href} className="rui-search-item" onSelect={() => close(() => window.location.assign(item.href))} onClickCapture={event => { if (!ordinaryClick(event)) event.stopPropagation() }}>
                  <a className="rui-search-link" href={item.href} tabIndex={-1} onClick={event => { if (ordinaryClick(event)) event.preventDefault() }}>
                    <item.icon aria-hidden="true" size={15} />
                    <span className="rui-search-result-copy"><span className="rui-search-result-name">{item.title}</span><span className="rui-search-result-meta">{item.description}</span></span>
                    <ArrowUpRight aria-hidden="true" size={14} />
                  </a>
                </CommandItem>)}
              </CommandGroup>}
            </CommandList>
            <div className="rui-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
          </Command>
        </DialogContent>
      </Dialog>
    )
  }

  createRoot(host).render(<SearchDialog />)
  return true
}
