import { Download, Folder, Grid2X2, Shirt } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { AutoBash } from './AutoBash'
import { exportTemplatePng, regionLabel, templates } from './template'
import type { TemplateKind } from './template'

type View = 'Auto Bash' | 'Studio' | 'My Projects'

const modes = ['Auto Bash', 'Studio'] as const
const steps = ['Upload', 'Processing', 'Result']

function TemplateWorkspace() {
  const [kind, setKind] = useState<TemplateKind>('shirt')
  const [showRegions, setShowRegions] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const { label, width, height, regions } = templates[kind]

  async function downloadTemplate() {
    setExportError(false)
    setIsExporting(true)
    try {
      const png = await exportTemplatePng(kind)
      const url = URL.createObjectURL(png)
      const link = document.createElement('a')
      link.href = url
      link.download = `threadport-${kind}-template.png`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch {
      setExportError(true)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="workspace">
      <section className="panel preview" aria-labelledby="preview-title">
        <div className="panel-header">
          <h2 id="preview-title">Template preview</h2>
          <span className="template-size">{width} × {height} px</span>
        </div>
        <div className="preview-area">
          <div
            className="checkerboard"
            style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}
            aria-label={`Blank ${label} template`}
            role={showRegions ? 'group' : 'img'}
          >
            {showRegions ? (
              regions.map(({ part, face, x, y, w, h }) => (
                <div
                  className="region"
                  key={`${part}.${face}`}
                  title={regionLabel(kind, part, face)}
                  style={{
                    left: `${(x / width) * 100}%`,
                    top: `${(y / height) * 100}%`,
                    width: `${(w / width) * 100}%`,
                    height: `${(h / height) * 100}%`,
                  }}
                >
                  <span>{regionLabel(kind, part, face)}</span>
                </div>
              ))
            ) : (
              <div className="blank-preview" aria-hidden="true">
                <Shirt size={24} strokeWidth={1.5} />
                <span>Blank template</span>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="panel controls" aria-labelledby="settings-title">
        <h2 id="settings-title">Template settings</h2>
        <fieldset>
          <legend>Clothing type</legend>
          <div className="type-options">
            {(['shirt', 'pants', 't-shirt'] as const).map((option) => (
              <label key={option} className="type-option">
                <input
                  type="radio"
                  name="clothing-type"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                />
                <span>{templates[option].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="guide-control">
          <Grid2X2 size={16} aria-hidden="true" />
          <span>Show regions</span>
          <input
            type="checkbox"
            checked={showRegions}
            onChange={(event) => setShowRegions(event.target.checked)}
          />
        </label>
        <div className="export">
          <p>The PNG is blank and transparent. Region guides stay in the preview.</p>
          <button
            className="primary-button"
            type="button"
            onClick={downloadTemplate}
            disabled={isExporting}
          >
            <Download size={16} aria-hidden="true" />
            {isExporting ? 'Preparing PNG…' : 'Download PNG'}
          </button>
          {exportError && <p role="alert">The download failed. Try downloading again.</p>}
        </div>
      </section>
    </div>
  )
}

export function App() {
  const [view, setView] = useState<View>('Auto Bash')
  const [projectName, setProjectName] = useState('Untitled project')
  const [processing, setProcessing] = useState(false)
  const reduceMotion = useReducedMotion()

  function switchView(next: View) {
    if (next === view) return
    setProcessing(false)
    setView(next)
  }

  return (
    <>
      <header className="top-bar">
        <div className="top-bar-inner">
          <button className="wordmark" type="button" onClick={() => switchView('Auto Bash')}>
            ThreadPort
          </button>
          <div className="top-bar-center">
            {view === 'Auto Bash' && (
              <ol className="steps" aria-label="Auto Bash progress">
                {steps.map((step, index) => (
                  <li key={step} aria-current={index === (processing ? 1 : 0) ? 'step' : undefined}>
                    {index > 0 && <span aria-hidden="true">·</span>}
                    {step}
                  </li>
                ))}
              </ol>
            )}
            {view === 'Studio' && (
              <input
                className="project-name"
                aria-label="Project name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                onBlur={() => setProjectName(projectName.trim() || 'Untitled project')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            )}
          </div>
          <nav className="top-bar-actions" aria-label="Workspace">
            <div className="mode-tabs" role="group" aria-label="Mode">
              {modes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={view === mode}
                  onClick={() => switchView(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              className="projects-button"
              type="button"
              aria-label="My Projects"
              aria-pressed={view === 'My Projects'}
              onClick={() => switchView('My Projects')}
            >
              <Folder size={16} aria-hidden="true" />
              <span>My Projects</span>
            </button>
          </nav>
        </div>
      </header>

      <motion.main
        key={view}
        className={view === 'Studio' ? 'studio' : undefined}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
      >
        {view === 'Auto Bash' ? <AutoBash onProcessingChange={setProcessing} /> : (
          <>
            <div className="page-heading">
              <h1>{view}</h1>
              {view === 'Studio' && <p>Start with a blank template. Editing tools will come in a later stage.</p>}
              {view === 'My Projects' && <p>Saved projects will appear here once project saving is available.</p>}
            </div>
            {view === 'Studio' && <TemplateWorkspace />}
          </>
        )}
      </motion.main>
    </>
  )
}
