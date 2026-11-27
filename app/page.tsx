import StudioPreview from '@/components/StudioPreview'
import Nav from '@/components/Nav'
import MotionRoot from '@/components/MotionRoot'
import PriceDial from '@/components/PriceDial'
import Footer from '@/components/Footer'

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
        <StudioPreview />

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
