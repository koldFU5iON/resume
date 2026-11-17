// Public landing page (/), issue #403. Ported from docs/design/landing-page/mockup.html.
// Product visuals are static, illustrative sample content (fictional "Northstar" and
// "Alex Morgan"), never real user data. Styles: ./landing.css, scoped under .lp.
import Link from 'next/link'
import { CurrntIcon } from '@/components/brand/icon'
import { brand } from '@/lib/brand'
import { Reveal } from './reveal'
import './landing.css'

function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="lp-i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
    <symbol id="lp-i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></symbol>
    <symbol id="lp-i-alert" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></symbol>
    <symbol id="lp-i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></symbol>
    <symbol id="lp-i-plus-c" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></symbol>
    <symbol id="lp-i-left" viewBox="0 0 24 24"><path d="m12 19-7-7 7-7M19 12H5"/></symbol>
    <symbol id="lp-i-right" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></symbol>
    <symbol id="lp-i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
    <symbol id="lp-i-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
    <symbol id="lp-i-archive" viewBox="0 0 24 24"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/></symbol>
    <symbol id="lp-i-scope" viewBox="0 0 24 24"><path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44M13.56 11.747l4.332-.924M16 21l-3.105-6.21M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455zM6.158 8.633l1.114 4.456M8 21l3.105-6.21"/><circle cx="12" cy="13" r="2"/></symbol>
    <symbol id="lp-i-file" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/></symbol>
    <symbol id="lp-i-plus" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></symbol>
    <symbol id="lp-i-copy" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></symbol>
    <symbol id="lp-i-badge" viewBox="0 0 24 24"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/></symbol>
    <symbol id="lp-i-gauge" viewBox="0 0 24 24"><path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0"/></symbol>
    <symbol id="lp-i-ext" viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></symbol>
    <symbol id="lp-i-msg" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></symbol>
    <symbol id="lp-i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>
    <symbol id="lp-i-key" viewBox="0 0 24 24"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></symbol>
    <symbol id="lp-i-plug" viewBox="0 0 24 24"><path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></symbol>
    <symbol id="lp-i-code" viewBox="0 0 24 24"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></symbol>
    <symbol id="lp-i-home" viewBox="0 0 24 24"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></symbol>
    <symbol id="lp-i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></symbol>
    <symbol id="lp-i-compass" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/></symbol>
    <symbol id="lp-i-bino" viewBox="0 0 24 24"><path d="M10 10h4M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2zM22 16H2M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2zM9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3"/></symbol>
    <symbol id="lp-i-list" viewBox="0 0 24 24"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01"/></symbol>
    <symbol id="lp-i-pen" viewBox="0 0 24 24"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4M2 6h4M2 10h4M2 14h4M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></symbol>
    <symbol id="lp-i-lock" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
    <symbol id="lp-i-gh" viewBox="0 0 24 24"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3"/></symbol>
      </defs>
    </svg>
  )
}

export function LandingPage({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="lp" id="lp-root">
      <IconSprite />
<header className="nav">
  <div className="wrap">
    <a className="logo" href="#top" aria-label={`${brand.name} home`}><CurrntIcon size={24} />currnt</a>
    <nav className="nav-links" aria-label="Page sections">
      <a href="#how">How it works</a>
      <a href="#features">Features</a>
      <a href="#agents">For AI agents</a>
      <a href="#cost">Cost</a>
      <a href="#faq">FAQ</a>
    </nav>
    <div className="nav-right">
      <a className="gh" href="#open-source"><svg aria-hidden="true"><use href="#lp-i-gh"/></svg><span>Open source</span></a>
      {isAuthenticated ? (
        <Link className="btn btn-primary btn-sm" href="/dashboard">Go to dashboard</Link>
      ) : (
        <>
          <Link className="btn btn-ghost btn-sm signin" href="/sign-in">Sign in</Link>
          <Link className="btn btn-primary btn-sm" href="/sign-up">Get started</Link>
        </>
      )}
    </div>
  </div>
</header>

<main id="top">
{/* ═════════ HERO ═════════ */}
<section className="hero" aria-labelledby="hero-h">
  <div className="wrap">
    <div className="hero-text">
      <p className="eyebrow">Stay current.</p>
      <h1 id="hero-h">Know which jobs are worth it. <em>Then write the CV that proves it.</em></h1>
      <p className="lede">currnt keeps a structured record of your career, checks every job you save against it, researches the ones you’re serious about, and gives each application its own writing desk. You see the reasoning. You approve every edit.</p>
      <div className="hero-cta">
        {isAuthenticated ? (
          <Link className="btn btn-primary btn-lg" href="/dashboard">Go to dashboard</Link>
        ) : (
          <Link className="btn btn-primary btn-lg" href="/sign-up">Get started free</Link>
        )}
        <a className="btn btn-outline btn-lg" href="#how">See how it works</a>
        {!isAuthenticated && (
          <span className="hero-signin">Have an account? <Link href="/sign-in">Sign in</Link></span>
        )}
      </div>
      <ul className="facts" aria-label="Key facts">
        <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg>Open source, MIT licence</li>
        <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg>AI runs on your own Anthropic, OpenAI or Google key</li>
        <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg>Connects to ChatGPT and Claude</li>
      </ul>
    </div>

    <figure className="hero-shot">
      <div className="frame" role="img" aria-label="The currnt job workspace: a Senior Programme Manager role at Northstar with status In progress, an early assessment of 7 out of 10, a deep dive verdict of Apply, with caveats, and a tailored CV open in the Writing Desk with Markdown on the left and a preview on the right.">
        <div className="app" aria-hidden="true">
          <aside className="sb">
            <div className="sb-brand"><CurrntIcon size={20} />currnt</div>
            <div className="sb-search"><svg className="i"><use href="#lp-i-search"/></svg>Search or jump to…<kbd>⌘K</kbd></div>
            <div className="sb-add"><svg className="i"><use href="#lp-i-plus"/></svg>Add job</div>
            <div className="sb-label">Career</div>
            <div className="sb-item"><svg className="i"><use href="#lp-i-home"/></svg>Home</div>
            <div className="sb-item"><svg className="i"><use href="#lp-i-user"/></svg>Professional Profile</div>
            <div className="sb-item"><svg className="i"><use href="#lp-i-compass"/></svg>Search Context</div>
            <div className="sb-label">Job Hunt</div>
            <div className="sb-item"><svg className="i"><use href="#lp-i-bino"/></svg>Discover Jobs</div>
            <div className="sb-item on"><svg className="i"><use href="#lp-i-list"/></svg>Applications</div>
            <div className="sb-label">Application Tools</div>
            <div className="sb-item"><svg className="i"><use href="#lp-i-pen"/></svg>Writing Desk</div>
            <div className="sb-label">Active jobs</div>
            <div className="sb-job">Senior Programme Manager<small>Northstar</small></div>
            <div className="sb-foot">
              <div className="sb-item"><svg className="i"><use href="#lp-i-msg"/></svg>Career Coach</div>
            </div>
          </aside>
          <div className="ws">
            <div className="ws-head">
              <span className="ws-back"><svg className="i"><use href="#lp-i-left"/></svg></span>
              <div className="ws-id"><p>Northstar</p><h3>Senior Programme Manager</h3></div>
              <span className="apply">Apply<svg className="i"><use href="#lp-i-ext"/></svg></span>
              <div className="ws-ctl">
                <span className="ctl"><span className="dot"></span>In progress<svg className="i"><use href="#lp-i-down"/></svg></span>
                <span className="fit"><span className="score">7/10</span><span><svg className="i"><use href="#lp-i-scope"/></svg><span className="chip chip-info">Apply, with caveats</span></span></span>
                <span className="archive"><svg className="i"><use href="#lp-i-archive"/></svg><span>Archive</span></span>
              </div>
            </div>
            <div className="tabs">
              <span className="tab"><svg className="i"><use href="#lp-i-file"/></svg>Job Description</span>
              <span className="tab on"><svg className="i"><use href="#lp-i-file"/></svg>CV: Programme leadership</span>
              <span className="tab extra"><svg className="i"><use href="#lp-i-file"/></svg>Interview notes</span>
              <span className="tab-plus"><svg className="i"><use href="#lp-i-plus"/></svg></span>
            </div>
            <div className="doc-bar">
              <strong>CV: Programme leadership</strong>
              <span className="saved"><svg className="i"><use href="#lp-i-check"/></svg>Saved</span>
              <div className="doc-actions">
                <span className="mini">CV prompt</span>
                <span className="seg"><span>Write</span><span className="on">Split</span><span>Preview</span></span>
                <span className="mini export">Export</span>
              </div>
            </div>
            <div className="draft-strip">
              <span><b>Agent created the draft.</b> <span className="muted">Accepting replaces the live document with this draft.</span></span>
              <span className="acts"><span className="mini">Discard</span><span className="mini prim">Accept draft</span></span>
            </div>
            <div className="split">
<div className="md"><span className="h">{"# Alex Morgan"}</span>{"\n{{contact}}\n\n"}<span className="h">{"## Profile"}</span>{"\nProgramme leader connecting strategy, delivery\nand organisational change across complex teams.\n\n"}<span className="h">{"## Experience"}</span>{"\n"}<span className="h">{"### Programme Director \u00b7 Example Org"}</span>{"\n"}<span className="c">{"2021 to present"}</span>{"\n- Led cross-functional delivery across product,\n  engineering and operations.\n- "}<mark>{"Ran quarterly planning for six teams, cutting\n  slipped milestones over two cycles."}</mark>{"\n- Built governance that made risk visible.\n"}</div>
              <div className="pv">
                <div className="paper">
                  <h4>Alex Morgan</h4>
                  <p className="role">Senior Programme Manager</p>
                  <h5>Profile</h5>
                  <p>Programme leader connecting strategy, delivery and organisational change across complex teams.</p>
                  <h5>Experience</h5>
                  <p><b>Programme Director · Example Org</b> <span className="muted">· 2021 to present</span></p>
                  <ul>
                    <li>Led cross-functional delivery across product, engineering and operations.</li>
                    <li>Ran quarterly planning for six teams, cutting slipped milestones over two cycles.</li>
                    <li>Built governance that made risk visible.</li>
                  </ul>
                  <h5>Skills</h5>
                  <p>Programme strategy · Stakeholder alignment · Change management</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="shot-caption">The job workspace. Illustrative job and CV.</figcaption>
    </figure>
  </div>
</section>

{/* ═════════ HOW IT WORKS ═════════ */}
<section id="how" className="band sec" aria-labelledby="how-h">
  <div className="wrap">
    <div className="sec-head">
      <p className="eyebrow">How it works</p>
      <h2 id="how-h">From job ad to finished application, in one place.</h2>
      <p>Four steps, each one optional. Use the whole loop, or only the parts you need.</p>
    </div>
    <ol className="steps">
      <li className="step">
        <span className="n">01</span>
        <h3>Capture</h3>
        <p>Paste a link and currnt pulls in the role and company. Or send jobs from a bookmarklet, the command line, Claude Code, or a friend’s Scout link.</p>
        <div className="ui" aria-hidden="true">
          <div className="ui-input"><svg className="i"><use href="#lp-i-plus"/></svg><span className="url">boards.greenhouse.io/northstar/jobs/…</span><span className="mini">Add job</span></div>
        </div>
      </li>
      <li className="step">
        <span className="n">02</span>
        <h3>Assess</h3>
        <p>Every saved job gets an early assessment: a score from 1 to 10, plus the blockers, strengths and gaps behind it.</p>
        <div className="ui" aria-hidden="true">
          <div className="ui-stack">
            <span className="pill"><span className="t-ok" style={{ fontWeight: "600" }}>7/10</span><span className="t-mut">·</span>Pursue</span>
            <span className="ui-note">Assessed in 6 s</span>
          </div>
        </div>
      </li>
      <li className="step">
        <span className="n">03</span>
        <h3>Research</h3>
        <p>For the roles you’re serious about, a deep dive researches the company, pay and practicalities, then gives you a verdict with sources.</p>
        <div className="ui" aria-hidden="true">
          <div className="ui-stack">
            <span className="pill"><svg className="i t-mut" style={{ width: "13px", height: "13px" }}><use href="#lp-i-scope"/></svg><span className="chip chip-info">Apply, with caveats</span></span>
            <span className="ui-note">12 sources · cost shown per run</span>
          </div>
        </div>
      </li>
      <li className="step">
        <span className="n">04</span>
        <h3>Write</h3>
        <p>Each job gets its own named documents: CVs, notes, letters. Write them yourself, with your own AI app, or let a connected agent propose a draft.</p>
        <div className="ui" aria-hidden="true">
          <div className="ui-tabs"><span>Job Description</span><span className="on">CV</span><span>Notes</span><span>+</span></div>
        </div>
      </li>
    </ol>
  </div>
</section>

{/* ═════════ FEATURES ═════════ */}
<section id="features" className="sec" style={{ paddingTop: "24px", paddingBottom: "64px" }} aria-label="Features">
  <div className="wrap">

    {/* Decide */}
    <article className="feat">
      <div className="feat-text">
        <p className="eyebrow">Decide</p>
        <h3>A first read in seconds. A full report when it matters.</h3>
        <p className="intro">Stop spending evenings on applications that were never going to land. currnt tells you early, and shows its working.</p>
        <ul>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Early assessment on every job.</b> A score and a level (Weak, Consider, Pursue or Priority), with hard blockers like work rights listed up front.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Deep dive on demand.</b> Three researchers look into the company, pay and practicalities. They never see your profile. One final step weighs what they found against your record.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>No invented facts.</b> A finding must cite a page the search returned or quote the ad word for word. Anything else is dropped.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>UK visa sponsorship.</b> Employers are checked against the Home Office register of licensed sponsors.</span></li>
        </ul>
      </div>
      <div className="visual decide" aria-hidden="true">
        <div className="card">
          <div className="card-pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h4 className="t-ok">Pursue</h4><span className="mono hint">7/10</span></div>
            <div className="gauge"><i style={{ width: "70%" }}></i></div>
            <p className="sub">Strengths</p>
            <div className="row-i"><svg className="i t-ok"><use href="#lp-i-check"/></svg><span>Programme leadership across product and engineering</span></div>
            <div className="row-i"><svg className="i t-ok"><use href="#lp-i-check"/></svg><span>Seniority matches the role</span></div>
            <p className="sub">Gaps</p>
            <div className="row-i"><svg className="i t-warn"><use href="#lp-i-alert"/></svg><span>Asks for 3+ years in payments; your profile shows 1</span></div>
            <p className="sub">Check these</p>
            <div className="row-i"><svg className="i t-mut"><use href="#lp-i-help"/></svg><span>Hybrid, 2 days in London?</span></div>
          </div>
          <div className="foot-line">jev · assessed in 6 s</div>
        </div>
        <div className="card">
          <div className="card-pad">
            <p className="hint" style={{ marginBottom: "4px" }}>Deep dive · Northstar</p>
            <p className="verdict">Apply, with caveats</p>
            <p style={{ marginTop: "6px", fontSize: "12.5px" }}>Strong programme fit and a licensed sponsor. The payments gap is real but closable with one targeted project in your CV.</p>
            <dl className="dl2">
              <div><dt>Worth a tailored CV</dt><dd>Yes<small>Lead with the planning work.</small></dd></div>
              <div><dt>Chance of an interview</dt><dd>Medium<small>Gap on domain years.</small></dd></div>
            </dl>
            <p className="sub">Suggested ask</p>
            <dl className="ask">
              <div><dt>Floor</dt><dd>£78k</dd></div>
              <div className="em"><dt>Target</dt><dd>£86k</dd></div>
              <div><dt>Stretch</dt><dd>£92k</dd></div>
            </dl>
            <p className="sub">Practicalities</p>
            <div className="row-i"><svg className="i t-ok"><use href="#lp-i-badge"/></svg><span>Licensed sponsor · A-rated (UK register)</span></div>
            <p className="sub">Sources</p>
            <div className="src"><div><span>[1]</span> northstar.example/careers</div><div><span>[2]</span> Job ad, quoted</div></div>
          </div>
        </div>
      </div>
    </article>

    {/* Write */}
    <article className="feat flip">
      <div className="feat-text">
        <p className="eyebrow">Write</p>
        <h3>One job, as many documents as it needs.</h3>
        <p className="intro">The Writing Desk sits inside each job. Keep a CV, a cover note and your interview prep side by side, each with its own history.</p>
        <ul>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Markdown with a live preview,</b> then export when it reads right.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Use the AI app you already pay for.</b> Copy a CV prompt that carries the deep dive’s strategy into ChatGPT or Claude, then paste the result back.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Drafts, not overwrites.</b> A connected agent can propose a draft. Your live document only changes when you accept it.</span></li>
        </ul>
      </div>
      <div className="visual writing" aria-hidden="true">
        <div className="frame">
          <div className="tabs">
            <span className="tab"><svg className="i"><use href="#lp-i-file"/></svg>Job Description</span>
            <span className="tab on"><svg className="i"><use href="#lp-i-file"/></svg>CV: Programme leadership</span>
            <span className="tab extra"><svg className="i"><use href="#lp-i-file"/></svg>Cover note</span>
            <span className="tab-plus"><svg className="i"><use href="#lp-i-plus"/></svg></span>
          </div>
          <div className="split">
<div className="md"><span className="h">{"## Experience"}</span>{"\n"}<span className="h">{"### Programme Director \u00b7 Example Org"}</span>{"\n"}<span className="c">{"2021 to present"}</span>{"\n- Led cross-functional delivery\n  across product, engineering\n  and operations.\n- Ran quarterly planning for\n  six teams.\n"}</div>
            <div className="pv"><div className="paper">
              <h5 style={{ marginTop: "0" }}>Experience</h5>
              <p><b>Programme Director · Example Org</b></p>
              <ul><li>Led cross-functional delivery across product, engineering and operations.</li><li>Ran quarterly planning for six teams.</li></ul>
            </div></div>
          </div>
        </div>
        <div className="card prompt-sheet">
          <div className="card-pad">
            <h4>Draft a CV in your own AI app</h4>
            <p className="hint" style={{ marginTop: "4px" }}>Includes your saved deep-dive CV strategy and the supported CV blocks.</p>
            <span className="btn btn-primary btn-sm" style={{ marginTop: "12px", height: "30px", fontSize: "13px" }}><svg className="i"><use href="#lp-i-copy"/></svg>Copy CV prompt</span>
            <textarea readOnly tabIndex={-1} defaultValue={"You are drafting a CV for Senior Programme Manager at Northstar.\nRead my profile through the currnt connection.\nCV strategy: lead with planning and delivery\u2026"} />
          </div>
        </div>
      </div>
    </article>

    {/* Record */}
    <article className="feat">
      <div className="feat-text">
        <p className="eyebrow">Record</p>
        <h3>Your whole career, written down once.</h3>
        <p className="intro">Everything else in currnt reads from your profile. Write it the way you remember it: one note per role or project, as long as it needs to be.</p>
        <ul>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Notes, not form fields.</b> Experience and projects are documents you can keep adding to.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Evidence linked to skills,</b> so every claim in a CV can point back to something you did.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Start from your current CV.</b> Import it, then fill in what it left out.</span></li>
        </ul>
      </div>
      <div className="visual" aria-hidden="true">
        <div className="frame">
          <div className="profile">
            <div className="notes-nav">
              <div className="lbl">Experience</div>
              <div className="n on">Programme Director</div>
              <div className="n">Delivery Lead</div>
              <div className="n">Project Manager</div>
              <div className="lbl">Projects</div>
              <div className="n">Quarterly planning reset</div>
              <div className="n">Vendor consolidation</div>
              <div className="lbl">Records</div>
              <div className="n">Certifications</div>
              <div className="n">Education</div>
            </div>
            <div className="note">
              <h4>Programme Director</h4>
              <p className="meta">Example Org · 2021 to present</p>
              <p>Took over a portfolio of six teams with no shared plan. Set up a quarterly planning cycle and a single risk log the exec team actually read.</p>
              <p>Ran the <a>quarterly planning reset</a>: two cycles in, slipped milestones dropped and teams stopped double-booking engineers.</p>
              <p className="muted">Still to write up: the vendor consolidation and what it saved.</p>
            </div>
            <div className="props">
              <p className="lbl">Evidence</p>
              <div className="ev">Fewer slipped milestones over two cycles<small>Quarterly planning reset</small></div>
              <div className="ev">One risk log for six teams<small>Programme Director</small></div>
              <p className="lbl">Skills</p>
              <span className="tag">Roadmapping</span><span className="tag">Risk management</span><span className="tag">Stakeholder alignment</span>
            </div>
          </div>
        </div>
      </div>
    </article>

    {/* Find */}
    <article className="feat flip">
      <div className="feat-text">
        <p className="eyebrow">Find</p>
        <h3>Watch the companies you care about.</h3>
        <p className="intro">currnt isn’t a job board. It checks the places you choose and brings back roles that match your search.</p>
        <ul>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>A watchlist of employers.</b> currnt checks their Greenhouse, Lever, Ashby and SmartRecruiters careers pages.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Boards, if you want them.</b> Turn on Remotive or Remote OK, or add keys for Adzuna and JSearch.</span></li>
          <li><svg className="i" aria-hidden="true"><use href="#lp-i-check"/></svg><span><b>Scout links.</b> Give a friend or recruiter a private link so they can send roles straight to you.</span></li>
        </ul>
      </div>
      <div className="visual hunt" aria-hidden="true">
        <div className="card">
          <div className="crit"><span><em>Roles</em>Programme Manager, Delivery Lead</span><span><em>Countries</em>UK</span><span><em>Remote</em>Hybrid</span></div>
          <div className="scan"><span className="ok"></span><span><b className="fg">14</b> Companies</span><span><b className="fg">2</b> Job Sources</span><span><b className="fg">3</b> Found today</span><span className="mini" style={{ marginLeft: "auto" }}>Sync All</span></div>
          <div className="jrow"><div><b>Senior Programme Manager</b><p className="m">Northstar · London</p><p className="m tags"><span className="chip chip-warm">solid · 7/10</span><span className="chip chip-info">New</span><span className="fg">£80k-£90k</span><span>Posted 2 days ago</span><span>Company watch</span></p></div><div className="r"><span className="mini prim">Import</span><span className="mini ghost">Ignore</span></div></div>
          <div className="jrow"><div><b>Delivery Lead, Platform</b><p className="m">Example Labs · Remote, UK</p><p className="m tags"><span className="chip chip-info">possible · 5/10</span><span>Posted 4 days ago</span><span>Job board</span></p></div><div className="r"><span className="mini prim">Import</span><span className="mini ghost">Ignore</span></div></div>
          <div className="jrow"><div><b>Programme Manager, Operations</b><p className="m">Sample Co · Manchester</p><p className="m tags"><span>Found today</span><span>Scout</span></p></div><div className="r"><span className="mini">Score Fit</span><span className="mini prim">Import</span></div></div>
          <div className="watch"><span className="muted">Watching</span><span className="tag">Northstar</span><span className="tag">Example Labs</span><span className="tag">Sample Co</span><span className="tag">+11</span></div>
        </div>
      </div>
    </article>

    {/* Also */}
    <div className="also">
      <div><h4>Career Coach</h4><p>A chat that knows your profile, the job you’re on and its deep dive. Ask it what to lead with.</p></div>
      <div><h4>Search context</h4><p>Tell currnt what you’re after once: roles, countries, pay, dealbreakers. Assessments use it.</p></div>
      <div><h4>Usage you can see</h4><p>Every AI call is logged by feature, so you know what a deep dive cost on your key.</p></div>
      <div><h4>A pipeline that keeps up</h4><p>Statuses from not started to accepted, with notes, contacts and dates on every job.</p></div>
    </div>
  </div>
</section>

{/* ═════════ AGENTS ═════════ */}
<section id="agents" className="agents sec" aria-labelledby="agents-h">
  <div className="wrap">
    <div className="sec-head">
      <p className="eyebrow">For AI agents</p>
      <h2 id="agents-h">Your career record, available to the AI tools you already use.</h2>
      <p>currnt runs an MCP server. Connect ChatGPT or Claude, and they can read your jobs and profile and draft a CV straight into a job’s Writing Desk.</p>
    </div>
    <div className="agent-grid">
      <div>
        <div className="routes">
          <div className="route"><h4>ChatGPT and Claude</h4><p>Add currnt as a custom connector and sign in. You choose read-only access or permission to write drafts.</p></div>
          <div className="route"><h4>Claude Code</h4><p>One command with a scoped token, or install the ready-made <code>capture-job</code> skill. A Hermes skill is available too.</p></div>
          <div className="route"><h4>Anywhere else</h4><p>A capture API for scripts and a browser bookmarklet that saves the tab you’re on.</p></div>
        </div>
        <p className="agent-note"><svg className="i" aria-hidden="true"><use href="#lp-i-lock"/></svg><span>Agents never see your contact details, and they can’t accept their own drafts. That’s always you.</span></p>
      </div>
      <div className="term" aria-label="Example: adding currnt to Claude Code">
        <div className="term-top"><svg className="i" aria-hidden="true"><use href="#lp-i-code"/></svg>terminal</div>
<pre><span className="d">{"$"}</span>{" claude mcp add --transport http currnt \\\n    https://<your-currnt-host>/api/mcp \\\n    --header \"Authorization: Bearer rsm_\u2026\"\n"}<span className="g">{"\u2713"}</span>{" Added HTTP MCP server currnt\n\n"}<span className="d">{">"}</span>{" "}<span className="p">{"Draft a CV for the Northstar role, leading with planning."}</span></pre>
        <div className="tools" aria-label="Some of the MCP tools">
          <div><span>list_jobs</span><span>read</span></div>
          <div><span>get_job_context</span><span>read</span></div>
          <div><span>profile_search</span><span>read</span></div>
          <div><span>profile_gaps</span><span>read</span></div>
          <div><span>create_draft</span><span>write</span></div>
          <div><span>replace_section</span><span>write</span></div>
        </div>
      </div>
    </div>
  </div>
</section>

{/* ═════════ COST ═════════ */}
<section id="cost" className="sec" aria-labelledby="cost-h">
  <div className="wrap">
    <div className="sec-head">
      <p className="eyebrow">Cost</p>
      <h2 id="cost-h">Free to run yourself. A small fee if we host it.</h2>
      <p>currnt is open source. Run it on your own server for nothing, or let us host it. We don’t resell AI, so your AI costs go straight to your own provider.</p>
    </div>
    <div className="cost">
      <div className="card"><p className="what">Self-hosted</p><p className="price">Free</p><p>MIT licence. Clone the repo, bring your own Postgres and run every feature on your own infrastructure.</p></div>
      <div className="card hosted">
        <p className="what">Hosted account</p>
        <p className="price"><span className="blurred" aria-hidden="true">$7 / month</span><span className="sr-only">Pricing to be announced.</span></p>
        <p className="early"><svg className="i" aria-hidden="true"><use href="#lp-i-check" /></svg>Free during early development</p>
        <p>We run it for you: hosting, storage, backups, email and the early assessment. <span className="blurred" aria-hidden="true">Or $19 for 90 days, $75 a year.</span></p>
      </div>
      <div className="card"><p className="what">AI features</p><p className="price">Your provider’s rates</p><p>Deep dives, Coach and CV help run on your Anthropic, OpenAI or Google key. A usage page shows each call and its cost.</p></div>
    </div>
    <p className="early-note">Hosted accounts are free while currnt is in early development.</p>
  </div>
</section>

{/* ═════════ SELF-HOST ═════════ */}
<section id="open-source" className="band sec" aria-labelledby="oss-h">
  <div className="wrap selfhost">
    <div className="sec-head">
      <p className="eyebrow">Open source</p>
      <h2 id="oss-h">Read the code. Or run it yourself.</h2>
      <p>currnt is MIT licensed. Everything the AI does is in the repository, from the prompts to the checks that drop unsourced claims. Host your own copy and your career record lives in your own database.</p>
      <div className="hero-cta" style={{ marginTop: "28px" }}><a className="btn btn-outline" href={brand.githubUrl} target="_blank" rel="noopener noreferrer"><svg className="i" aria-hidden="true" style={{ fill: "currentColor", stroke: "none" }}><use href="#lp-i-gh"/></svg>View on GitHub</a></div>
    </div>
    <div>
      <div className="clone" aria-label="Self-host commands">
        <div><span className="d">$</span>git clone {brand.githubUrl}.git<span className="cp"><svg className="i" aria-hidden="true"><use href="#lp-i-copy"/></svg></span></div>
        <div><span className="d">$</span>cd currnt &amp;&amp; npm install &amp;&amp; cp .env.example .env.local</div>
        <div><span className="d">$</span>docker compose up -d &amp;&amp; npm run dev</div>
        <div className="d" style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>Full setup, including the database, is in the README.</div>
      </div>
      <div className="stack" aria-label="Built with"><span>Next.js</span><span>PostgreSQL</span><span>Prisma</span><span>TypeScript</span><span>MCP</span></div>
    </div>
  </div>
</section>

{/* ═════════ FAQ ═════════ */}
<section id="faq" className="sec" aria-labelledby="faq-h">
  <div className="wrap faq">
    <div className="sec-head">
      <p className="eyebrow">FAQ</p>
      <h2 id="faq-h">Questions people ask first.</h2>
    </div>
    <div>
      <details open><summary>Do I need an AI key to start?<svg className="i" aria-hidden="true"><use href="#lp-i-plus"/></svg></summary><p>No. You can build your profile, track jobs and write in the Writing Desk without one. Add a key from Anthropic, OpenAI or Google when you want deep dives, Coach or CV help.</p></details>
      <details><summary>Will an AI send applications for me?<svg className="i" aria-hidden="true"><use href="#lp-i-plus"/></svg></summary><p>No. currnt and connected agents can propose drafts. Nothing replaces your document until you accept it, and nothing is sent anywhere on your behalf.</p></details>
      <details><summary>Is currnt a job board?<svg className="i" aria-hidden="true"><use href="#lp-i-plus"/></svg></summary><p>No. There are no listings to browse and no employers paying for placement. Job hunt only checks the companies and boards you choose.</p></details>
      <details><summary>What do the AI researchers see?<svg className="i" aria-hidden="true"><use href="#lp-i-plus"/></svg></summary><p>Only the public details of the job. Your profile, goals and notes are never sent to the research step. One final step compares the research with your profile.</p></details>
      <details><summary>Does sponsorship checking work outside the UK?<svg className="i" aria-hidden="true"><use href="#lp-i-plus"/></svg></summary><p>Not yet. It uses the UK register of licensed sponsors and matches company names exactly, so it shows a match but can’t prove a company isn’t licensed.</p></details>
      <details><summary>Can I move my data out?<svg className="i" aria-hidden="true"><use href="#lp-i-plus"/></svg></summary><p>Documents export from the Writing Desk, and the whole app is open source, so you can run your own copy.</p></details>
    </div>
  </div>
</section>

{/* ═════════ FINAL CTA ═════════ */}
<section className="band final" aria-labelledby="final-h">
  <div className="wrap">
    <h2 id="final-h">Start with one job.</h2>
    <p>Save a role you’re weighing up and see what currnt makes of it.</p>
    <div className="hero-cta">{isAuthenticated ? (
      <Link className="btn btn-primary btn-lg" href="/dashboard">Go to dashboard</Link>
    ) : (
      <Link className="btn btn-primary btn-lg" href="/sign-up">Get started free</Link>
    )}<a className="btn btn-ghost btn-lg" href="#open-source">Run it yourself</a></div>
  </div>
</section>
</main>

<footer>
  <div className="wrap">
    <a className="logo" href="#top" aria-label={`${brand.name} home`}><CurrntIcon size={24} />currnt</a>
    <span>Built to help people find work. MIT licensed.</span>
    <nav aria-label="Footer">
      <Link href="/about">About</Link>
      <Link href="/support">Support</Link>
      <a href={brand.githubUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
      {isAuthenticated ? (
        <Link href="/dashboard">Dashboard</Link>
      ) : (
        <>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up">Get started</Link>
        </>
      )}
    </nav>
  </div>
</footer>

      <Reveal rootId="lp-root" />
    </div>
  )
}
