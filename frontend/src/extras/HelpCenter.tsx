import flatLay from '../../../samples/black shirt test.JPG?url'
import worn from '../../../samples/white shirt on body test.JPG?url'

export function HelpCenter() {
  return <div className="help-page">
    <header className="page-heading">
      <h1>Help center</h1>
      <p>Take a better photo, fix your result, and choose the right file for Roblox.</p>
    </header>
    <section className="panel help-photos" aria-labelledby="help-photo-title">
      <h2 id="help-photo-title">Take a photo Auto Bash can use</h2>
      <div className="help-examples">
        <figure>
          <img src={flatLay} alt="A dark shirt laid flat, with its sleeves and hem in frame" />
          <figcaption><strong>Lay the garment flat.</strong> Spread out the sleeves or legs, photograph from straight above, and keep the whole garment in frame. Use a plain background and even lighting if possible.</figcaption>
        </figure>
        <figure>
          <img src={worn} alt="A printed shirt worn by a person" />
          <figcaption><strong>Photograph the back separately.</strong> Worn photos often hide fabric in folds or behind arms. A back photo helps preserve real details on the back.</figcaption>
        </figure>
      </div>
    </section>
    <section className="panel help-answers" aria-labelledby="help-fixes-title">
      <h2 id="help-fixes-title">Fix and export</h2>
      <details>
        <summary>Which template should I choose?</summary>
        <p>Choose Shirt for a top that wraps around the body and arms, Pants for bottoms, or T-Shirt for a square graphic that sits on the chest. Use Auto to let ThreadPort pick.</p>
      </details>
      <details>
        <summary>What if part of my template looks wrong?</summary>
        <p>Try Quick-Fix first. Turn on Show regions to find the affected face, then use Edit in Studio to place another piece or paint over the area. The right and left labels refer to the avatar’s sides.</p>
      </details>
      <details>
        <summary>How do I check logos and text?</summary>
        <p>The logo and text check looks for high-contrast artwork. Review anything it flags and check the design yourself. Remove artwork or replace it with an original PNG if you need to.</p>
      </details>
      <details>
        <summary>Which file do I upload to Roblox?</summary>
        <p>Use Download PNG for the clothing template. For a set or batch, unzip the archive and upload the individual PNGs. Check current fees and upload rules on Roblox Creator Hub.</p>
        <a href="https://create.roblox.com/docs/avatar/classic-clothing" target="_blank" rel="noreferrer">Roblox Classic Clothing guide</a>
      </details>
      <details>
        <summary>Where are saved projects?</summary>
        <p>Open My Projects in the browser where you created the project. Studio saves projects in that browser’s storage. Download the PNG if you need a copy outside the browser.</p>
      </details>
    </section>
  </div>
}
