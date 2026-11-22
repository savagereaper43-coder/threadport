import { Folder } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AutoBash } from './AutoBash'
import type { AutoBashStep } from './AutoBash'
import { Home, Projects } from './studio/Projects'
import { HelpCenter } from './extras/HelpCenter'
import { deleteProject, id, loadProjects, newProject, saveProject } from './studio/model'
import type { Project } from './studio/model'
import type { TemplateKind } from './template'

const StudioEditor = lazy(() => import('./studio/StudioEditor'))
const routes = { Home: '', 'Auto Bash': '#auto-bash', Studio: '#studio', 'My Projects': '#projects', 'Help center': '#help' }
type View = keyof typeof routes
const modes = ['Auto Bash', 'Studio'] as const
const steps = ['Upload', 'Processing', 'Result']

function currentView(): View {
  return (Object.keys(routes) as View[]).find((key) => routes[key] === window.location.hash) ?? 'Home'
}

export function App() {
  const [view, setView] = useState<View>(currentView)
  const projects = useRef(new Map<string, Project>())
  const discarded = useRef(new Set<string>())
  const [cards, setCards] = useState<Project[]>([])
  const [draft, setDraft] = useState(newProject)
  const [active, setActive] = useState('')
  const [step, setStep] = useState<AutoBashStep>('Upload')
  const [pending, setPending] = useState(0)
  const [storageError, setStorageError] = useState('')
  const activeProject = cards.find((project) => project.id === (active || draft.id)) ?? draft
  const reduceMotion = useReducedMotion()

  function refresh() {
    setCards([...projects.current.values()].sort((a, b) => b.updated - a.updated))
  }

  useEffect(() => {
    let mounted = true
    loadProjects().then((stored) => {
      if (!mounted) return
      for (const project of stored) if (!projects.current.has(project.id)) projects.current.set(project.id, project)
      refresh()
    }).catch(() => { if (mounted) setStorageError('We couldn’t open browser storage. Projects may be unavailable.') })
    const navigate = () => { setView(currentView()); setStep('Upload') }
    window.addEventListener('hashchange', navigate)
    return () => { mounted = false; window.removeEventListener('hashchange', navigate) }
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [view])

  function write(project: Project) {
    if (discarded.current.has(project.id)) return
    projects.current.set(project.id, project)
    refresh()
    setPending((old) => old + 1)
    void saveProject(project).then(() => setStorageError(''))
      .catch(() => setStorageError('We couldn’t save this project in browser storage. You can still download its PNG.'))
      .finally(() => setPending((old) => old - 1))
  }

  function changeProject(update: (project: Project) => Project) {
    const current = projects.current.get(activeProject.id) ?? activeProject
    if (!projects.current.has(current.id) && draft.id !== current.id) return
    const next = update(current)
    if (next === current) return
    const updated = next.thumbnail !== current.thumbnail && next.layers === current.layers ? current.updated : Date.now()
    write({ ...next, thumbnail: next.layers.length ? next.thumbnail : undefined, updated })
  }

  function remove(project: Project) {
    discarded.current.add(project.id)
    projects.current.delete(project.id)
    refresh()
    if (active === project.id || draft.id === project.id) {
      setActive('')
      setDraft(newProject())
    }
    void deleteProject(project.id).catch(() => {
      discarded.current.delete(project.id)
      write(project)
      setStorageError('We couldn’t delete that project. Try again.')
    })
  }

  function navigate(next: View) {
    if (next === view) return
    if (next === 'Auto Bash') setStep('Upload')
    setView(next)
    window.location.hash = routes[next]
  }

  function openProject(project: Project) {
    if (!projects.current.has(project.id)) write(project)
    setActive(project.id)
    navigate('Studio')
  }

  function create(kind: TemplateKind) {
    const project = newProject(kind)
    setDraft(project)
    setActive('')
    navigate('Studio')
  }

  function rename(name: string) {
    if (name !== activeProject.name) changeProject((project) => ({ ...project, name }))
  }

  return <>
    <header className="top-bar">
      <div className="top-bar-inner">
        <button className="wordmark" type="button" onClick={() => navigate('Home')}>ThreadPort</button>
        <div className="top-bar-center">
          {view === 'Auto Bash' && <ol className="steps" aria-label="Auto Bash progress">
            {steps.map((label, index) => <li key={label} aria-current={label === step ? 'step' : undefined}>
              {index > 0 && <span aria-hidden="true">·</span>}{label}</li>)}
          </ol>}
          {view === 'Studio' && <input className="project-name" aria-label="Project name" value={activeProject.name} maxLength={100}
            onChange={(event) => rename(event.target.value)}
            onBlur={() => rename(activeProject.name.trim() || 'Untitled project')}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />}
        </div>
        <nav className="top-bar-actions" aria-label="Workspace">
          <div className="mode-tabs" role="group" aria-label="Mode">
            {modes.map((mode) => <button type="button" key={mode} aria-pressed={view === mode}
              onClick={() => navigate(mode)}>{mode}</button>)}
          </div>
          <button className="projects-button" type="button" aria-label="My Projects" aria-pressed={view === 'My Projects'}
            onClick={() => navigate('My Projects')}><Folder size={16} aria-hidden="true" /><span>My Projects</span></button>
        </nav>
      </div>
    </header>

    <motion.main key={view} className={view === 'Studio' ? 'studio' : undefined}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : .2, ease: 'easeOut' }}>
      {storageError && <p className="storage-error" role="alert">{storageError}</p>}
      {view === 'Home' && <Home projects={cards} open={openProject} start={() => navigate('Auto Bash')} studio={() => navigate('Studio')} />}
      {view === 'Auto Bash' && <AutoBash onStepChange={setStep} openStudio={openProject} />}
      {view === 'Studio' && <Suspense fallback={<p role="status">Opening Studio…</p>}>
        <StudioEditor key={activeProject.id} project={activeProject} change={changeProject} openProject={openProject}
          createProject={create} saving={pending ? 'Saving…' : cards.some((item) => item.id === activeProject.id) && !storageError ? 'Saved' : ''} />
      </Suspense>}
      {view === 'Help center' && <HelpCenter />}
      {view === 'My Projects' && <Projects projects={cards} open={openProject}
        duplicate={(project) => write({ ...project, id: id(), name: `${project.name} copy`, updated: Date.now() })}
        remove={remove} move={(project, folder) => write({ ...project, folder, updated: Date.now() })}
        create={() => create('shirt')} />}
    </motion.main>
    <footer className="app-footer">
      <a href="#help" aria-current={view === 'Help center' ? 'page' : undefined}>Help center</a>
    </footer>
  </>
}
