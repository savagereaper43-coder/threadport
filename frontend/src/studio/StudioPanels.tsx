import { Eye, EyeOff, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { regionLabel, templates } from '../template'
import { assetNames } from './assets'
import type { Asset } from './assets'
import { blends, isStroke } from './edit'
import type { Options, Tool } from './edit'
import { faceKey, neutral } from './model'
import type { Face, Layer, Project, Settings } from './model'

export function Range({ label, value, min = 0, max = 100, step = 1, change }: {
  label: string; value: number; min?: number; max?: number; step?: number; change: (value: number) => void
}) {
  return <label className="studio-range"><span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value}
      onChange={(event) => change(event.target.valueAsNumber)} />
    <output aria-hidden="true">{value}</output></label>
}

export function BlendSelect({ label, value, change }: {
  label: string; value: GlobalCompositeOperation; change: (value: GlobalCompositeOperation) => void
}) {
  return <label className="studio-field">{label}<select value={value} onChange={(event) => change(event.target.value as GlobalCompositeOperation)}>
    {blends.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}
  </select></label>
}

export function ToolOptions({ tool, options, set, chooseColor, hasSelection, clearSelection, eraseSelection, selected, transform }: {
  tool: Tool; options: Options; set: <K extends keyof Options>(key: K, value: Options[K]) => void
  chooseColor: (color: string) => void; hasSelection: boolean; clearSelection: () => void; eraseSelection: () => void
  selected?: Layer; transform: (layer: Layer) => void
}) {
  const paint = isStroke(tool) || ['fill', 'gradient', 'text', 'shape'].includes(tool)
  const transforming = ['move', 'warp', 'perspective'].includes(tool) && selected
  return <div className="studio-options" aria-label="Tool options">
    {tool === 'move' && !selected && <span>Select a layer to move or transform it.</span>}
    {tool === 'perspective' && selected && <span>Drag a corner to change perspective.</span>}
    {tool === 'warp' && selected && <span>Drag a control point to reshape the layer.</span>}
    {paint && <>
      <label className="studio-field">Color <input aria-label="Tool color" type="color" value={options.color}
        onChange={(event) => chooseColor(event.target.value)} /></label>
      {tool === 'gradient' && <label className="studio-field">End color <input type="color" value={options.color2}
        onChange={(event) => set('color2', event.target.value)} /></label>}
      {(isStroke(tool) || tool === 'text') && <Range label="Size" min={1} max={160} value={options.size} change={(v) => set('size', v)} />}
      <Range label="Tool opacity" value={options.opacity} change={(v) => set('opacity', v)} />
      {isStroke(tool) && <>
        <Range label="Hardness" value={options.hardness} change={(v) => set('hardness', v)} />
        <Range label="Flow" value={options.flow} change={(v) => set('flow', v)} />
        <label className="studio-field"><input type="checkbox" checked={options.symmetric}
          onChange={(event) => set('symmetric', event.target.checked)} /> Symmetry</label>
      </>}
      <BlendSelect label="Tool blend" value={options.blend} change={(v) => set('blend', v)} />
      <label className="studio-field"><input type="checkbox" checked={options.clip}
        onChange={(event) => set('clip', event.target.checked)} /> Clip to region</label>
    </>}
    {(tool === 'wand' || tool === 'fill') && <Range label="Tolerance" value={options.tolerance} max={255} change={(v) => set('tolerance', v)} />}
    {tool === 'clone' && <span>Alt-click to pick the fabric to copy.</span>}
    {tool === 'text' && <>
      <input aria-label="Artwork text" type="text" maxLength={160} placeholder="Type text, then click the canvas" value={options.text}
        onChange={(event) => set('text', event.target.value)} />
      <label className="studio-field">Font <select value={options.font} onChange={(event) => set('font', event.target.value)}>
        {['Arial', 'Georgia', 'Courier New', 'Impact'].map((font) => <option key={font}>{font}</option>)}
      </select></label>
    </>}
    {tool === 'shape' && <label className="studio-field">Shape <select value={options.shape}
      onChange={(event) => set('shape', event.target.value as Options['shape'])}>
      <option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option>
    </select></label>}
    {transforming && <>
      {(['x', 'y', 'w', 'h'] as const).map((key, i) => <label key={key} className="studio-field">{['X', 'Y', 'Width', 'Height'][i]}
        <input type="number" min={i >= 2 ? 1 : -2000} max={2000} disabled={selected.locked}
          value={Math.round(selected[key])} onChange={(event) => {
            const number = event.target.valueAsNumber
            if (Number.isFinite(number) && (i < 2 || number >= 1)) transform({ ...selected, [key]: number })
          }} /></label>)}
      <Range label="Rotation" min={-180} max={180} value={selected.angle ?? 0} change={(angle) => transform({ ...selected, angle })} />
      <button className="secondary-button" type="button" onClick={() => transform({ ...selected, flip: !selected.flip })}>Flip horizontal</button>
      {tool !== 'move' && <button className="secondary-button" type="button" onClick={() => transform({ ...selected, warp: undefined })}>Reset warp</button>}
    </>}
    {hasSelection && <>
      <button type="button" className="secondary-button" onClick={clearSelection}>Deselect</button>
      <button type="button" className="secondary-button" onClick={eraseSelection} disabled={!selected || selected.locked}>Clear selected pixels</button>
    </>}
  </div>
}

type PanelProps = {
  project: Project; selected?: Layer; region?: Face; showSeams: boolean; mask: boolean; image?: HTMLCanvasElement
  selectLayer: (layer: Layer) => void; updateLayer: (layer: Layer) => void
  moveLayer: (layer: Layer, direction: number) => void; addLayer: () => void; deleteLayer: (layer: Layer) => void
  duplicateLayer: () => void; addGroup: () => void; selectRegion: (face?: Face) => void
  renameGroup: (id: string, name: string) => void; flipGroup: (id: string, hidden: boolean) => void
  toggleSeams: (show: boolean) => void; toggleMask: (show: boolean) => void
  color: string; colors: string[]; chooseColor: (color: string) => void
  stampAsset: (asset: Asset) => void; shade: (strength: number, color: string) => void
  place: (mode: 'fit' | 'wrap' | 'tile' | 'tile-all') => void; hasPiece: boolean
  mirror: (mode: 'limb' | 'back', removeLogo: boolean) => void
  quick: (mode: 'logo' | 'plain' | 'regenerate', scope: 'layer' | 'region') => void
}

function SeamPreview({ image, face, faces }: { image: HTMLCanvasElement; face: Face; faces: readonly Face[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    const sideOrder = ['front', 'left', 'back', 'right']
    const band = sideOrder.map((side) => faces.find((part) => part.part === face.part && part.face === side))
    const index = Math.max(0, sideOrder.indexOf(face.face))
    const ordered = [band[(index + 3) % 4], band[index], band[(index + 1) % 4]]
    let x = 0
    for (const item of ordered) {
      if (!item) continue
      const w = item.w * 192 / ordered.reduce((total, value) => total + (value?.w ?? 0), 0)
      ctx.drawImage(image, item.x, item.y, item.w, item.h, x, 0, w, 86)
      if (x) {
        ctx.fillStyle = '#3b82f6'
        ctx.fillRect(x, 0, 1, 86)
      }
      x += w
    }
  }, [image, face, faces])
  return <canvas className="studio-seam-canvas" ref={canvas} width={192} height={86}
    role="img" aria-label="Fabric across adjacent side seams" />
}

export function StudioPanels(props: PanelProps) {
  const [tab, setTab] = useState<'Layers' | 'Regions' | 'Assets' | 'Colors'>('Layers')
  const [shadeStrength, setShadeStrength] = useState(65)
  const [shadeColor, setShadeColor] = useState('#151c2a')
  const [removeLogo, setRemoveLogo] = useState(false)
  const [scope, setScope] = useState<'layer' | 'region'>('layer')
  const { project, region, selected } = props
  const { regions } = templates[project.kind]
  function adjust<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (selected && !selected.locked) props.updateLayer({ ...selected, settings: { ...(selected.settings ?? neutral), [key]: value } })
  }
  const s = selected?.settings ?? neutral
  return <aside className="studio-sidebar" aria-label="Studio panels">
    <div className="studio-tabs" role="group" aria-label="Studio panel">
      {(['Layers', 'Regions', 'Assets', 'Colors'] as const).map((name) =>
        <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}
    </div>
    <div className="studio-panel-body">
      {tab === 'Layers' && <>
        <div className="studio-row">
          <button type="button" className="secondary-button" onClick={props.addLayer}>Add layer</button>
          <button type="button" className="secondary-button" onClick={props.addGroup}>Add group</button>
        </div>
        {project.groups.map((group) => {
          const members = project.layers.filter((item) => item.group === group.id)
          const hidden = members.every((item) => item.hidden)
          return <div className="studio-group" key={group.id}>
            <input aria-label={`Name for ${group.name}`} defaultValue={group.name} maxLength={80}
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name && name !== group.name) props.renameGroup(group.id, name)
                else event.target.value = group.name
              }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
            <span>{members.length} {members.length === 1 ? 'layer' : 'layers'}</span>
            <button type="button" aria-label={`${hidden ? 'Show' : 'Hide'} group ${group.name}`} disabled={!members.length}
              onClick={() => props.flipGroup(group.id, !hidden)}>{hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
        })}
        <div className="studio-layers" aria-label="Layer stack">
          {[...project.layers].reverse().map((layer) => <div className={selected?.id === layer.id ? 'studio-layer active' : 'studio-layer'} key={layer.id}>
            <button type="button" className="studio-layer-name" aria-pressed={selected?.id === layer.id}
              onClick={() => props.selectLayer(layer)}><img src={layer.src} alt="" /><span>{layer.name}
                {layer.group && <small>{project.groups.find((g) => g.id === layer.group)?.name}</small>}</span></button>
            <button type="button" aria-label={layer.hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
              onClick={() => props.updateLayer({ ...layer, hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            <button type="button" aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
              onClick={() => props.updateLayer({ ...layer, locked: !layer.locked })}>{layer.locked ? <LockKeyhole size={15} /> : <LockKeyholeOpen size={15} />}</button>
          </div>)}
          {!project.layers.length && <p>Paint on the template or place a photo piece to add a layer.</p>}
        </div>
        {selected && <>
          <label className="studio-field">Layer name <input value={selected.name} maxLength={80}
            onChange={(event) => props.updateLayer({ ...selected, name: event.target.value })} /></label>
          <Range label="Layer opacity" value={Math.round(selected.opacity * 100)}
            change={(value) => props.updateLayer({ ...selected, opacity: value / 100 })} />
          <BlendSelect label="Layer blend" value={selected.blend} change={(blend) => props.updateLayer({ ...selected, blend })} />
          <label className="studio-field">Group <select value={selected.group ?? ''}
            onChange={(event) => props.updateLayer({ ...selected, group: event.target.value || undefined })}>
            <option value="">Ungrouped</option>
            {project.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select></label>
          <div className="studio-row">
            <button type="button" className="secondary-button" onClick={() => props.moveLayer(selected, 1)} disabled={project.layers.at(-1)?.id === selected.id}>Raise</button>
            <button type="button" className="secondary-button" onClick={() => props.moveLayer(selected, -1)} disabled={project.layers[0]?.id === selected.id}>Lower</button>
            <button type="button" className="secondary-button" onClick={props.duplicateLayer}>Duplicate layer</button>
            <button type="button" className="secondary-button" disabled={selected.locked} onClick={() => props.deleteLayer(selected)}>Delete layer</button>
          </div>
          <label className="studio-field"><input type="checkbox" checked={props.mask} disabled={selected.locked}
            onChange={(event) => props.toggleMask(event.target.checked)} /> Edit layer mask</label>
          {props.mask && <p>Use Eraser to hide and Brush to reveal.</p>}
          {selected.mask && <button className="secondary-button" disabled={selected.locked} type="button" onClick={() => props.updateLayer({ ...selected, mask: undefined })}>Remove mask</button>}
          <details className="studio-disclosure">
            <summary>Adjustments</summary>
            <Range label="Brightness" min={-100} value={s.brightness} change={(v) => adjust('brightness', v)} />
            <Range label="Contrast" min={-100} value={s.contrast} change={(v) => adjust('contrast', v)} />
            <Range label="Hue" min={-180} max={180} value={s.hue} change={(v) => adjust('hue', v)} />
            <Range label="Saturation" min={-100} value={s.saturation} change={(v) => adjust('saturation', v)} />
            <Range label="Black level" max={254} value={s.black} change={(v) => adjust('black', v)} />
            <Range label="White level" min={1} max={255} value={s.white} change={(v) => adjust('white', v)} />
            <Range label="Midtone curve" min={.2} max={3} step={.05} value={s.gamma} change={(v) => adjust('gamma', v)} />
            <Range label="Red balance" min={-100} value={s.red} change={(v) => adjust('red', v)} />
            <Range label="Green balance" min={-100} value={s.green} change={(v) => adjust('green', v)} />
            <Range label="Blue balance" min={-100} value={s.blue} change={(v) => adjust('blue', v)} />
            <label className="studio-field">Recolor <input type="color" value={s.tint} onChange={(event) => adjust('tint', event.target.value)} /></label>
            <Range label="Recolor strength" value={s.tintAmount} change={(v) => adjust('tintAmount', v)} />
            <button type="button" className="secondary-button" disabled={selected.locked}
              onClick={() => props.updateLayer({ ...selected, settings: undefined })}>Reset adjustments</button>
          </details>
        </>}
      </>}
      {tab === 'Regions' && <>
        <label className="studio-field"><input type="checkbox" checked={props.showSeams}
          onChange={(event) => props.toggleSeams(event.target.checked)} /> Show seams</label>
        <div className="studio-regions">
          {regions.map((face) => <button type="button" key={faceKey(face)} aria-pressed={region === face}
            onClick={() => props.selectRegion(face)}>{regionLabel(project.kind, face.part, face.face)}</button>)}
        </div>
        {region && <button type="button" className="secondary-button" onClick={() => props.selectRegion(undefined)}>Exit region view</button>}
        {props.showSeams && region && project.kind !== 't-shirt' && <>
          {props.image && <SeamPreview image={props.image} face={region} faces={regions} />}
          <p>The blue lines mark the joins between adjacent faces.</p>
        </>}
        <div className="studio-row">
          <button className="secondary-button" type="button" disabled={!region || !props.hasPiece} onClick={() => props.place('fit')}>Place selected piece</button>
          <button className="secondary-button" type="button" disabled={!region || region.part === 'torso' || !props.hasPiece}
            onClick={() => props.place('wrap')}>Wrap around limb</button>
        </div>
        {project.kind !== 't-shirt' && <>
          <button type="button" className="secondary-button" onClick={() => props.mirror('limb', false)}>Copy left limb to right</button>
          <label className="studio-field"><input type="checkbox" checked={removeLogo}
            onChange={(event) => setRemoveLogo(event.target.checked)} /> Remove logo on copy</label>
          <button type="button" className="secondary-button" onClick={() => props.mirror('back', removeLogo)}>Copy front to back</button>
        </>}
      </>}
      {tab === 'Assets' && <>
        <div className="studio-asset-grid">
          {assetNames.map((asset) => <button type="button" className="secondary-button" key={asset} onClick={() => props.stampAsset(asset)}>{asset}</button>)}
        </div>
        <h3>Pattern tiling</h3>
        <button className="secondary-button" type="button" disabled={!region || !props.hasPiece} onClick={() => props.place('tile')}>Tile selected region</button>
        <button className="secondary-button" type="button" disabled={!props.hasPiece} onClick={() => props.place('tile-all')}>Tile all regions</button>
        <h3>Shading overlay</h3>
        <Range label="Shading strength" value={shadeStrength} change={setShadeStrength} />
        <label className="studio-field">Shading color <input type="color" value={shadeColor} onChange={(event) => setShadeColor(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={() => props.shade(shadeStrength, shadeColor)}>Add shading</button>
      </>}
      {tab === 'Colors' && <>
        <label className="studio-field">Active color <input type="color" value={props.color} onChange={(event) => props.chooseColor(event.target.value)} /></label>
        <h3>Palette</h3>
        <div className="swatches">
          {['#ffffff', '#111111', '#3b82f6', '#8b5cf6', '#be493f', '#ed9f30', '#398560', '#a78c72'].map((color) => <button
            key={color} type="button" className="swatch" style={{ background: color }} aria-pressed={color === props.color}
            aria-label={`Use ${color}`} onClick={() => props.chooseColor(color)} />)}
        </div>
        <h3>Recent colors</h3>
        <div className="swatches">
          {props.colors.map((color) => <button key={color} type="button" className="swatch" style={{ background: color }}
            aria-label={`Reuse ${color}`} onClick={() => props.chooseColor(color)} />)}
        </div>
      </>}
      {(tab === 'Layers' || tab === 'Regions') && <details className="studio-disclosure">
        <summary>Quick actions</summary>
        <label className="studio-field">Apply to <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
          <option value="layer">Selected layer</option><option value="region">Selected region</option>
        </select></label>
        <button type="button" className="secondary-button" disabled={scope === 'layer' ? !selected || selected.locked : !region}
          onClick={() => props.quick('logo', scope)}>Remove logo</button>
        {project.kind !== 't-shirt' && <>
          <button type="button" className="secondary-button" disabled={scope === 'layer' ? !selected || selected.locked : !region}
            onClick={() => props.quick('plain', scope)}>Make back plain</button>
          <button type="button" className="secondary-button" disabled={scope === 'layer' ? !selected || selected.locked : !region}
            onClick={() => props.quick('regenerate', scope)}>Regenerate back</button>
        </>}
      </details>}
    </div>
  </aside>
}
