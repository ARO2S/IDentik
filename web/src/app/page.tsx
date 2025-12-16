import Image from 'next/image';
import IdentikNameForm from '@/components/forms/IdentikNameForm';
import ProtectPhotoForm from '@/components/forms/ProtectPhotoForm';
import CheckPhotoForm from '@/components/forms/CheckPhotoForm';
import AuthPanel from '@/components/auth/AuthPanel';

const trustHighlights = [
  {
    title: 'Simple onboarding',
    copy: 'Pick a name like jenny.identik and you’re ready to protect photos in minutes.'
  },
  {
    title: 'No crypto jargon',
    copy: 'Plain-English guidance everywhere. No wallets or blockchains to manage.'
  },
  {
    title: 'Instant reassurance',
    copy: 'Friends and family can check a photo and see clear trust labels right away.'
  }
];

export default function Home() {
  return (
    <main>
      <header className="hero">
        <div className="content-width hero-content">
          <div className="hero-text">
            <h1>Trusted identity for trusted media.</h1>
            <p>
              Identik gives every family, newsroom, and community a simple Identik Name to sign real photos. No crypto
              buzzwords, just plain-English protection.
            </p>
            <div className="cta-row">
              <a className="primary-btn" href="#create-name">
                Create your Identik Name
              </a>
              <a className="secondary-btn" href="#check-photo">
                Check a photo now
              </a>
            </div>
          </div>
          <div>
            <Image
              src="/assets/identik_logo_splash_1000x500.svg"
              alt="Identik hero splash artwork"
              width={600}
              height={360}
              priority
              style={{ width: '100%', height: 'auto' }}
            />
          </div>
        </div>
      </header>

      <section className="section" id="create-name">
        <div className="content-width">
          <div className="section-heading">
            <h2>Your Identik Name in three easy steps</h2>
            <p>Pick a name, check availability, and activate it. Identik handles the rest.</p>
          </div>
          <div className="card-grid">
            <div className="card">
              <h3>Step 1 — Choose a name</h3>
              <p>Short, memorable, and unique to you. We’ll add .identik automatically.</p>
              <IdentikNameForm />
            </div>
            <div className="card">
              <h3>Step 2 — Sign in & activate</h3>
              <p>Sign in with your Identik account to claim the name permanently.</p>
              <ul>
                <li>Secure Supabase Auth handles sign-in</li>
                <li>One Identik Name per account to prevent name snatching</li>
                <li>No wallets or seed phrases required</li>
              </ul>
            </div>
            <div className="card">
              <h3>Step 3 — Start protecting</h3>
              <p>Upload a photo, click Protect, and share the signed copy anywhere.</p>
              <div className="trust-pills">
                <span className="trust-pill">✅ Trusted copies</span>
                <span className="trust-pill">🛡️ Identik stamp</span>
                <span className="trust-pill">💬 Plain-English status</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section sign-in-section" id="sign-in">
        <div className="content-width sign-in-layout">
          <div className="sign-in-copy">
            <h2>Sign in to keep protecting your media</h2>
            <p>
              Jump back into your Identik dashboard to activate reserved names, manage signatures, and view trust
              history.
            </p>
            <ul className="sign-in-benefits">
              <li>Email + password auth secured by Supabase</li>
              <li>Access your Identik Names from any device</li>
              <li>Ready to protect photos in seconds</li>
            </ul>
          </div>
          <div className="sign-in-panel">
            <AuthPanel />
          </div>
        </div>
      </section>

      <section className="section" id="protect-photo">
        <div className="content-width">
          <div className="section-heading">
            <h2>Protect a photo</h2>
            <p>Drop in your latest photo and Identik will sign it with your Identik Name.</p>
          </div>
          <div className="card-grid">
            <div className="card">
              <h3>Protect this photo</h3>
              <ProtectPhotoForm />
            </div>
            <div className="card">
              <h3>What happens behind the scenes?</h3>
              <ul>
                <li>We create a secure fingerprint of your photo.</li>
                <li>Identik embeds a tiny “who signed this” stamp.</li>
                <li>You download the protected version instantly.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="check-photo">
        <div className="content-width">
          <div className="section-heading">
            <h2>Check a photo</h2>
            <p>Upload any photo and get a simple Trusted, Caution, or Not protected answer.</p>
          </div>
          <div className="card-grid">
            <div className="card">
              <h3>Check protection</h3>
              <CheckPhotoForm />
            </div>
            <div className="card">
              <h3>What we look for</h3>
              <ul>
                <li>Cryptographic match between the photo and Identik stamp</li>
                <li>Domain reputation and event history</li>
                <li>Whether we’ve seen this photo in the Identik vault</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section trust-highlight-section">
        <div className="content-width">
          <div className="section-heading trust-highlight-copy">
            <p className="eyebrow">Onboarding • Cryptography • Reassurance</p>
            <h2>See every promise at a glance</h2>
            <p>Clear contrast and short copy keeps each pillar easy to scan, even at the end of the page.</p>
          </div>
          <div className="trust-highlight-grid">
            {trustHighlights.map((highlight) => (
              <div key={highlight.title} className="card trust-highlight-card">
                <h3>{highlight.title}</h3>
                <p>{highlight.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section story-section">
        <div className="content-width motto-panel">
          <div className="motto-copy">
            <p className="eyebrow">Plain-English trust</p>
            <h2>“Trusted identity for trusted media.”</h2>
            <p>
              Identik keeps wording simple for grandparents, parents, and newsrooms alike. Every button, message, and
              color cue is tuned for clarity, even when emotions are running high.
            </p>
            <ul className="motto-points">
              <li>Color-coded trust labels that match how families actually talk.</li>
              <li>Event history that spells out what happened without legalese.</li>
              <li>Photos, names, and reputation all connected in one glance.</li>
            </ul>
          </div>
          <div className="motto-art">
            <Image
              src="/assets/identik_logo_tagline_1000x500.svg"
              alt="Identik tagline lockup"
              width={1000}
              height={500}
              style={{ width: '100%', height: 'auto', borderRadius: '1rem' }}
            />
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="content-width footer-content">
          <strong>Identik</strong>
          <span>Trusted identity for trusted media.</span>
          <span>© {new Date().getFullYear()} Identik. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
