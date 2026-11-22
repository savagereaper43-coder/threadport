import { Copy, Folder, Image, Shirt, Trash2, WandSparkles } from 'lucide-react'
import { useState } from 'react'
import { templates } from '../template'
import type { Project } from './model'

type Cards = { projects: Project[]; open: (project: Project) => void; duplicate?: (project: Project) => void
  remove?: (project: Project) => void; move?: (project: Project, folder: string) => void }

function ProjectCards({ projects, open, duplicate, remove, move }: Cards) {
  const [pending, setPending] = useState('')
  return <div className="project-grid">
    {projects.map((project) => <article className="panel project-card" key={project.id}>
      <button className="project-open" type="button" onClick={() => open(project)}>
        <div className="project-thumb checkerboard">
          {project.thumbnail ? <img alt="" src={project.thumbnail} /> : <Shirt size={30} aria-hidden="true" />}
        </div>
        <div className="project-meta">
          <h3>{project.name.trim() || 'Untitled project'}</h3>
          <div><span>{templates[project.kind].label}</span>
            <time dateTime={new Date(project.updated).toISOString()}>
              {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(project.updated)}
            </time></div>
        </div>
      </button>
      {remove && duplicate && move && <div className="project-card-actions">
        <label className="studio-field"><Folder size={14} />
          <input aria-label={`Folder for ${project.name}`} placeholder="No folder" maxLength={60} list="saved-folders"
            defaultValue={project.folder} onBlur={(event) => {
              if (event.target.value.trim() !== project.folder) move(project, event.target.value.trim())
            }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
        </label>
        <button type="button" className="secondary-button" aria-label={`Duplicate ${project.name}`}
          title="Duplicate" onClick={() => duplicate(project)}><Copy size={15} /></button>
        <button type="button" className="secondary-button" aria-label={`Delete ${project.name}`}
          title="Delete" onClick={() => setPending(project.id)}><Trash2 size={15} /></button>
        {pending === project.id && <div className="project-delete">
          <p>Delete this project?</p>
          <button type="button" className="secondary-button" onClick={() => setPending('')}>Cancel</button>
          <button type="button" className="secondary-button" onClick={() => { remove(project); setPending('') }}>Delete project</button>
        </div>}
      </div>}
    </article>)}
  </div>
}

export function Home({ projects, open, start, studio }: Pick<Cards, 'projects' | 'open'> & { start: () => void; studio: () => void }) {
  return <div className="threadport-home">
    <div className="page-heading"><h1>Turn any clothes photo into Roblox clothing</h1></div>
    <div className="home-choices">
      <section className="panel home-choice home-auto">
        <WandSparkles aria-hidden="true" size={28} />
        <div className="home-choice-heading"><h2>Auto Bash</h2><span>Recommended</span></div>
        <p>Upload a photo. We cut, place and shade everything for you.</p>
        <button className="primary-button" type="button" onClick={start}>Start Auto Bash</button>
      </section>
      <section className="panel home-choice">
        <Image aria-hidden="true" size={26} />
        <h2>Studio</h2>
        <p>Photobash it yourself with pro tools, guides and snapping.</p>
        <button className="secondary-button" type="button" onClick={studio}>Open Studio</button>
      </section>
    </div>
    <section className="home-recent" aria-labelledby="recent-title">
      <h2 id="recent-title">Recent projects</h2>
      {projects.length ? <ProjectCards projects={projects.slice(0, 6)} open={open} /> : <p>No saved projects yet.</p>}
    </section>
  </div>
}

export function Projects({ projects, open, duplicate, remove, move, create }: Required<Cards> & { create: () => void }) {
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const folders = [...new Set(projects.map((project) => project.folder).filter(Boolean))].sort()
  const shown = projects.filter((project) => {
    const matchesFolder = !folder || (folder === 'unfiled' ? !project.folder : project.folder === folder.slice(7))
    return matchesFolder && `${project.name} ${templates[project.kind].label}`.toLowerCase().includes(query.trim().toLowerCase())
  })
  return <div className="projects-page">
    <div className="page-heading"><h1>My Projects</h1></div>
    <div className="project-filters">
      <label className="studio-field">Search <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="studio-field">Folder <select value={folder} onChange={(event) => setFolder(event.target.value)}>
        <option value="">All folders</option><option value="unfiled">Unfiled</option>
        {folders.map((item) => <option key={item} value={`folder:${item}`}>{item}</option>)}
      </select></label>
      <button className="primary-button" type="button" onClick={create}>New project</button>
      <datalist id="saved-folders">{folders.map((item) => <option key={item} value={item} />)}</datalist>
    </div>
    {shown.length ? <ProjectCards projects={shown} open={open} duplicate={duplicate} remove={remove} move={move} />
      : <p className="project-empty">{projects.length ? 'No projects match your search or folder.' : 'No saved projects yet. Create one in Studio.'}</p>}
  </div>
}
