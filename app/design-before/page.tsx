import HeroReel from '@/components/HeroReel'
import Nav from '@/components/Nav'
import MotionRoot from '@/components/MotionRoot'
import PriceDial from '@/components/PriceDial'
import Footer from '@/components/Footer'
import Pipeline from '@/components/Pipeline'
import styles from '@/components/UploadDemo.module.css'
import UploadDemo from '@/components/UploadDemo'

function SectionHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <header className="shead">
      <div className="shead-body">
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </header>
  )
}

export default function Home() {
  return (
    <>
      <MotionRoot />
      <Nav />
      <main id="top">
        <section className="hero" aria-label="Introduction">
          <HeroReel />
          <div className="hero-copy">
            <h1 className="hero-title">
              Your media library,<br />
              <span className="grad-text">ready to publish.</span>
            </h1>
            <div className="hero-aside">
              <p>Upload video, audio and images to MediaEX. Review files with your team, then share a link or embed a player.</p>
              <div className="hero-actions">
                <a href="/sign-up" className="btn btn-primary btn-lg">Start free</a>
                <a href="#tour" className="link-arrow" data-play-tour>Watch the 20-second tour</a>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div id="workflow">
            <SectionHead title="From upload to playback">
              Follow a file through encoding, image resizing, review and delivery.
            </SectionHead>
          </div>
          <div id="engine"><Pipeline /></div>
        </section>

        <section className={`section ${styles.section}`} id="developers" aria-labelledby="upload-title">
          <div className={styles.intro}>
            <h2 id="upload-title">Try a media upload.</h2>
            <p>Choose an image or video and follow its progress from upload to delivery in your workspace.</p>
            <a href="/dashboard/developers">Open developer dashboard <span aria-hidden="true">↗</span></a>
          </div>
          <UploadDemo />
        </section>
        <section className="section" id="pricing">
          <SectionHead title="Find a plan for your library">
            Adjust the library size to estimate your plan.
          </SectionHead>
          <PriceDial />
        </section>
      </main>
      <Footer />
    </>
  )
}
