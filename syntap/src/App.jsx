import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { isSupabaseConfigured, requireSupabase, setRememberSession, supabase } from './lib/supabase'
import syntapLogo from './assets/syntap.png'
import './App.css'

const AuthContext = createContext(null)
const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'X', 'GitHub', 'WhatsApp', 'Viber', 'Telegram', 'Messenger', 'Signal', 'Discord', 'WeChat', 'LINE', 'Slack', 'Skype', 'Behance', 'Dribbble', 'Calendly', 'Other']
const DEFAULT_SECTIONS = { about: true, contact: true, social: true, location: true, booking: true, showcase: true }
const CURRENT_YEAR = new Date().getFullYear()
const DEFAULT_THEME_SETTINGS = {
  theme: 'light',
  primary: '#111827',
  button_style: 'rounded',
  button_shape: 'rounded',
  button_appearance: 'soft',
  alignment: 'center',
  button_layout: 'default',
  profile_layout: 'standard',
}
const EMPTY_CARD = {
  full_name: '', job_title: '', company: '', bio: '', slug: '', profile_image: '',
  company_logo: '', cover_image: '', phone: '', email: '', whatsapp: '', website: '',
  address: '', map_url: '', booking_url: '', status: 'draft',
  theme_settings: DEFAULT_THEME_SETTINGS,
  section_settings: DEFAULT_SECTIONS,
  social_links: [],
  showcase_images: [],
}

function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return undefined
    let mounted = true
    const checkRole = async (nextSession) => {
      if (!nextSession) {
        if (mounted) {
          setSession(null)
          setIsAdmin(false)
          setLoading(false)
        }
        return
      }
      if (mounted) {
        setSession(nextSession)
        setLoading(true)
      }
      const { data, error } = await supabase.rpc('is_admin')
      if (mounted) {
        setIsAdmin(!error && data === true)
        setLoading(false)
      }
    }
    supabase.auth.getSession().then(({ data }) => checkRole(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => checkRole(nextSession), 0)
    })
    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({ session, isAdmin, loading }), [session, isAdmin, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function useAuth() {
  return useContext(AuthContext)
}

function Brand({ compact = false }) {
  return (
    <Link className={`brand${compact ? ' brand-compact' : ''}`} to="/" aria-label="SynTap home">
      <img src={syntapLogo} alt="" />
      {!compact && <span>SynTap</span>}
    </Link>
  )
}

function MediaImage({ path, alt, className, onLoad, onError, onClick }) {
  const [image, setImage] = useState({ path: '', url: '' })
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])
  useEffect(() => {
    let active = true
    if (!path?.trim()) return undefined
    if (safeWebUrl(path)) return undefined
    requireSupabase().storage.from('card-media').createSignedUrl(path, 3600).then(({ data, error }) => {
      if (error) {
        console.error('Could not load profile image:', error.message)
        onErrorRef.current?.()
        return
      }
      if (active) setImage({ path, url: data.signedUrl })
    })
    return () => { active = false }
  }, [path])
  const url = safeWebUrl(path) || (image.path === path ? image.url : '')
  return url ? <img className={className} src={url} alt={alt} onLoad={onLoad} onError={onError} onClick={onClick} /> : null
}

function PublicCover({ path, alt, onLoad, onError }) {
  const [loaded, setLoaded] = useState(false)
  const handleLoad = () => {
    setLoaded(true)
    onLoad()
  }
  const handleError = () => {
    setLoaded(false)
    onError()
  }
  if (!path?.trim()) return null
  return <div className={`public-cover${loaded ? ' public-cover-loaded' : ' public-cover-loading'}`} aria-hidden="true">
    <MediaImage path={path} alt={alt} onLoad={handleLoad} onError={handleError} />
  </div>
}

function PublicProfilePhoto({ path, name }) {
  const [failed, setFailed] = useState(false)
  return <div className="public-profile-photo">
    {path && !failed ? <MediaImage path={path} alt={`${name} profile`} onError={() => setFailed(true)} /> : <span>{name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
  </div>
}

function makeUploadPath(userId, file) {
  return `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

function ImageCropDialog({ file, field, onCancel, onApply }) {
  const viewportRef = useRef(null)
  const imageRef = useRef(null)
  const dragStart = useRef(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const ratio = field === 'cover_image' ? 3.4667 : 1
  const baseScale = imageSize.width && viewport.width
    ? Math.max(viewport.width / imageSize.width, viewport.height / imageSize.height)
    : 1
  const renderWidth = imageSize.width * baseScale * zoom
  const renderHeight = imageSize.height * baseScale * zoom
  const left = (viewport.width - renderWidth) / 2 + offset.x
  const top = (viewport.height - renderHeight) / 2 + offset.y

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    if (imageRef.current) imageRef.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  function clampOffset(next, nextZoom = zoom) {
    const width = imageSize.width * baseScale * nextZoom
    const height = imageSize.height * baseScale * nextZoom
    return {
      x: Math.min((width - viewport.width) / 2, Math.max(-(width - viewport.width) / 2, next.x)),
      y: Math.min((height - viewport.height) / 2, Math.max(-(height - viewport.height) / 2, next.y)),
    }
  }

  function changeZoom(value) {
    const nextZoom = Number(value)
    setZoom(nextZoom)
    setOffset((current) => clampOffset(current, nextZoom))
  }

  async function applyCrop() {
    const image = imageRef.current
    if (!image || !image.naturalWidth || !viewport.width) return
    setProcessing(true)
    setError('')
    try {
      const sourceX = Math.max(0, Math.min(image.naturalWidth, -left / (baseScale * zoom)))
      const sourceY = Math.max(0, Math.min(image.naturalHeight, -top / (baseScale * zoom)))
      const sourceWidth = Math.min(image.naturalWidth - sourceX, viewport.width / (baseScale * zoom))
      const sourceHeight = Math.min(image.naturalHeight - sourceY, viewport.height / (baseScale * zoom))
      const outputWidth = field === 'cover_image' ? 1600 : 1200
      const outputHeight = Math.round(outputWidth / ratio)
      const canvas = document.createElement('canvas')
      canvas.width = outputWidth
      canvas.height = outputHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Your browser could not prepare the cropped image.')
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight)
      const outputType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The cropped image could not be encoded.')), outputType, .9)
      })
      const extension = outputType === 'image/png' ? 'png' : outputType === 'image/webp' ? 'webp' : 'jpg'
      onApply(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-crop.${extension}`, { type: outputType, lastModified: Date.now() }))
    } catch (cropError) {
      setError(cropError.message)
      setProcessing(false)
    }
  }

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, x: offset.x, y: offset.y }
  }

  function onPointerMove(event) {
    if (!dragStart.current) return
    setOffset(clampOffset({
      x: dragStart.current.x + event.clientX - dragStart.current.pointerX,
      y: dragStart.current.y + event.clientY - dragStart.current.pointerY,
    }))
  }

  return <div className="crop-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <header><div><h2 id="crop-title">Crop {field === 'profile_image' ? 'profile photo' : 'cover photo'}</h2><p>Drag to reposition, then adjust the zoom.</p></div><button type="button" className="icon-link" onClick={onCancel} aria-label="Cancel cropping"><Icon name="close" size={18} /></button></header>
      <div ref={viewportRef} className={`crop-viewport${field === 'profile_image' ? ' crop-square' : ' crop-cover'}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragStart.current = null }} onPointerCancel={() => { dragStart.current = null }}>
        <img ref={imageRef} alt="Image crop preview" draggable="false" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: renderWidth, height: renderHeight, left, top }} />
        {field === 'profile_image' && <div className="crop-circle-mask" aria-hidden="true" />}
      </div>
      <label className="crop-zoom">Zoom<input type="range" min="1" max="3" step=".01" value={zoom} onChange={(event) => changeZoom(event.target.value)} /><span>{zoom.toFixed(1)}×</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button button-outline" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }}>Reset crop</button><span /><button type="button" className="button button-outline" disabled={processing} onClick={onCancel}>Cancel</button><button type="button" className="button button-dark" disabled={processing || !imageSize.width} onClick={applyCrop}>{processing ? 'Applying…' : 'Apply crop'}</button></footer>
    </section>
  </div>
}

function Icon({ name, size = 20 }) {
  const icons = {
    arrow: 'arrow-right',
    leftArrow: 'arrow-left',
    grid: 'grid',
    cards: 'person-vcard',
    personPlus: 'person-plus-fill',
    plus: 'plus-lg',
    qr: 'qr-code',
    chart: 'graph-up',
    settings: 'gear',
    logout: 'box-arrow-right',
    search: 'search',
    external: 'box-arrow-up-right',
    copy: 'copy',
    menu: 'list',
    close: 'x-lg',
    phone: 'telephone',
    sms: 'chat-text',
    share: 'share',
    download: 'download',
    email: 'envelope',
    whatsapp: 'whatsapp',
    location: 'geo-alt',
    nfc: 'broadcast',
    linkedin: 'linkedin',
    instagram: 'instagram',
    twitter: 'twitter-x',
    stars: 'stars',
    calendar: 'calendar3',
    link: 'link-45deg',
    facebook: 'facebook',
    tiktok: 'tiktok',
    youtube: 'youtube',
    github: 'github',
    telegram: 'telegram',
    discord: 'discord',
    slack: 'slack',
    skype: 'skype',
    signal: 'signal',
    messenger: 'messenger',
    wechat: 'wechat',
    line: 'line',
    behance: 'behance',
    dribbble: 'dribbble',
  }
  return <i className={`bi bi-${icons[name] || icons.grid} app-icon`} style={{ fontSize: size }} aria-hidden="true" />
}

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    if (!message) return undefined
    const timeout = window.setTimeout(onClose, 3600)
    return () => window.clearTimeout(timeout)
  }, [message, onClose])
  if (!message) return null
  return <div className={`toast toast-${type}`} role="status">{message}<button onClick={onClose} aria-label="Dismiss notification"><Icon name="close" size={16} /></button></div>
}

function ConfigurationNotice() {
  return (
    <div className="configuration-notice">
      <div className="notice-icon">!</div>
      <div>
        <strong>Connect your Supabase project</strong>
        <p>Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and anon key, then run the SQL migration in <code>supabase/migrations/</code>. See the setup steps in the README.</p>
      </div>
    </div>
  )
}

function HomePage() {
  const features = [
    ['01', 'Digital business cards', 'A polished profile that keeps every important detail in one place.', 'cards'],
    ['02', 'NFC tap-to-connect', 'Share your profile from a compatible NFC card with one simple tap.', 'nfc'],
    ['03', 'QR code sharing', 'A scannable link for print, events, and your everyday introduction.', 'qr'],
    ['04', 'Save contact', 'Let visitors download a vCard and add your details to their contacts.', 'personPlus'],
    ['05', 'Social media integration', 'Bring your professional links together in one easy-to-share profile.', 'share'],
    ['06', 'Customizable profiles', 'Make your profile feel like you with thoughtful colors and layouts.', 'settings'],
    ['07', 'Mobile-friendly design', 'A clear, responsive profile built for the phone in your visitor’s hand.', 'phone'],
    ['08', 'Contact analytics', 'Understand profile visits with privacy-conscious, first-party analytics.', 'chart'],
  ]
  return (
    <div className="site-shell">
      <header className="site-nav">
        <Brand />
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#contact">Contact</a>
        </nav>
        <Link className="button button-dark nav-login" to="/admin/login">Admin login <Icon name="arrow" size={16} /></Link>
      </header>
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> DIGITAL IDENTITY, REIMAGINED</div>
            <h1>Your identity.<br /><span>One tap away.</span></h1>
            <p className="hero-description">Create a smarter first impression with a digital business card that brings your contact details, social profiles, and professional story together.</p>
            <div className="hero-actions">
              <a className="button button-yellow" href="#features">Explore features <Icon name="arrow" size={17} /></a>
              <Link className="button button-plain" to="/admin/login">Administrator sign in <Icon name="external" size={14} /></Link>
            </div>
            <div className="hero-proof"><div className="proof-avatars"><span>J</span><span>M</span><span>A</span></div><span>Make every introduction count.</span></div>
          </div>
          <div className="hero-visual" aria-label="Digital profile card preview">
            <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
            <div className="floating-label floating-label-top"><span className="nfc-mark"><Icon name="nfc" size={17} /></span> Ready for one tap</div>
            <div className="profile-preview">
              <div className="preview-cover"><div className="cover-shape shape-a" /><div className="cover-shape shape-b" /><span className="preview-brand">ST<span>•</span></span></div>
              <div className="preview-avatar">AS</div>
              <div className="preview-content">
                <h3>Alex Santos</h3><p className="preview-role">Creative Director <span>·</span> Northstar Studio</p>
                <p className="preview-bio">Building brands and experiences that bring people together.</p>
                <div className="preview-contact"><span><Icon name="phone" size={15} /> Call</span><span><Icon name="email" size={15} /> Email</span><span><Icon name="share" size={15} /> Share</span></div>
                <div className="preview-socials"><i><Icon name="linkedin" size={13} /></i><i><Icon name="instagram" size={13} /></i><i><Icon name="twitter" size={13} /></i><i><Icon name="external" size={12} /></i></div>
              </div>
            </div>
            <div className="floating-label floating-label-bottom"><span className="mini-qr"><Icon name="qr" size={17} /></span> A better connection starts here</div>
            <span className="hero-spark spark-one"><Icon name="stars" size={16} /></span><span className="hero-spark spark-two"><Icon name="stars" size={12} /></span>
          </div>
        </section>
        <section className="trust-strip"><span>ONE PROFILE, EVERYWHERE</span><div className="trust-line" /><span>MADE FOR REAL-WORLD CONNECTIONS</span><div className="trust-line" /><strong>SynTap<span>.</span></strong></section>
        <section className="feature-section section-wrap" id="features">
          <div className="section-heading"><div><span className="section-kicker">A BETTER WAY TO CONNECT</span><h2>Make every connection<br />feel effortless.</h2></div><p>Everything you need to share a thoughtful, memorable introduction — all from one simple link.</p></div>
          <div className="feature-grid">{features.map(([number, title, body, icon]) => <article className="feature-card" key={title}><span className="feature-number">{number}</span><div className="feature-icon"><Icon name={icon} size={19} /></div><h3>{title}</h3><p>{body}</p><span className="feature-arrow"><Icon name="external" size={13} /></span></article>)}</div>
        </section>
        <section className="how-section" id="how-it-works"><div className="section-wrap how-inner">
          <div className="how-heading"><span className="section-kicker">SIMPLE BY DESIGN</span><h2>From hello to<br />in touch.</h2><p>One thoughtfully designed profile. Every way to share it.</p></div>
          <div className="steps">{[['01', 'Create a profile', 'Your SynTap administrator brings your details and links together.'], ['02', 'Make it yours', 'Choose a look that feels like you and preview it before it goes live.'], ['03', 'Share it anywhere', 'Publish your card, then share it with a QR code, NFC card, or link.']].map(([number, title, body]) => <div className="step" key={number}><span className="step-number">{number}</span><div><h3>{title}</h3><p>{body}</p></div><span className="step-arrow"><Icon name="external" size={14} /></span></div>)}</div>
        </div></section>
        <section className="cta-section section-wrap" id="contact"><div className="cta-card"><div className="cta-glow" /><div><span className="section-kicker">YOUR NEXT INTRODUCTION</span><h2>Bring your identity<br />closer to everyone.</h2><p>Designed for the moments that turn an introduction into a connection.</p></div><Link to="/admin/login" className="button button-yellow">Get started <Icon name="arrow" size={17} /></Link><img className="cta-mark" src={syntapLogo} alt="" /></div></section>
      </main>
      <footer className="site-footer"><div className="footer-main"><Brand /><p>Your identity, thoughtfully brought together. One tap away.</p><div className="footer-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/admin/login">Admin login</Link></div></div><div className="footer-bottom"><span>© {CURRENT_YEAR} SynTap</span><span>Made for meaningful connections.</span></div></footer>
    </div>
  )
}

function LoginPage() {
  const { session, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (session && isAdmin) navigate('/admin/dashboard', { replace: true }) }, [session, isAdmin, navigate])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const client = requireSupabase()
      setRememberSession(remember)
      const { error: loginError } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (loginError) throw loginError
      const { data, error: roleError } = await client.rpc('is_admin')
      if (roleError) throw roleError
      if (data !== true) {
        await client.auth.signOut()
        throw new Error('This account is not authorized to access SynTap administration.')
      }
      navigate('/admin/dashboard', { replace: true })
    } catch (loginError) {
      setError(loginError.message || 'Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="auth-page"><div className="auth-side"><Link to="/" className="auth-back"><Icon name="arrow" size={14} /> Back to SynTap</Link><div className="auth-brand"><Brand /><div className="auth-art"><div className="auth-art-card"><span className="auth-art-logo">S<span>•</span></span><div className="auth-art-lines"><i /><i /><i /></div><div className="auth-art-circle" /></div><span className="auth-art-spark"><Icon name="stars" size={17} /></span></div><p className="auth-quote">“A thoughtful introduction<br />can take you anywhere.”</p><span className="auth-side-caption">YOUR IDENTITY. ONE TAP AWAY.</span></div></div>
    <main className="auth-main"><div className="auth-form-wrap"><span className="section-kicker">SYNТAP ADMINISTRATION</span><h1>Welcome back.</h1><p className="auth-subtitle">Sign in to manage your digital cards and profiles.</p>
      {!isSupabaseConfigured && <ConfigurationNotice />}
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} className="auth-form">
        <label>Email address<input type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></span></label>
        <label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> <span>Remember me</span></label>
        <button className="button button-yellow auth-submit" type="submit" disabled={busy || !isSupabaseConfigured}>{busy ? 'Signing in…' : 'Sign in'} <Icon name="arrow" size={17} /></button>
      </form>
      <p className="auth-security">Access is restricted to authorized SynTap administrators.</p>
    </div></main></div>
}

function ProtectedRoute({ children }) {
  const { session, isAdmin, loading } = useAuth()
  if (loading) return <div className="full-loader"><span className="spinner" />Checking administrator access…</div>
  if (!session || !isAdmin) return <Navigate to="/admin/login" replace />
  return children
}

const ADMIN_NAV = [
  { to: '/admin/dashboard', label: 'Overview', icon: 'grid' },
  { to: '/admin/cards', label: 'Digital cards', icon: 'cards' },
  { to: '/admin/cards/new', label: 'Create new card', icon: 'plus' },
  { to: '/admin/qr-codes', label: 'QR codes', icon: 'qr' },
  { to: '/admin/analytics', label: 'Analytics', icon: 'chart' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
]

function AdminLayout({ children }) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  async function signOut() {
    const { error } = await requireSupabase().auth.signOut()
    if (error) window.alert(`Could not sign out: ${error.message}`)
    else navigate('/admin/login')
  }
  return <div className="admin-shell">
    <aside className={`admin-sidebar${menuOpen ? ' sidebar-open' : ''}`}><div className="sidebar-brand"><Brand /><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button></div>
      <span className="sidebar-caption">WORKSPACE</span><nav className="sidebar-nav">{ADMIN_NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/admin/cards'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `sidebar-link${isActive || (item.to === '/admin/cards' && window.location.pathname.includes('/admin/cards/') && !window.location.pathname.endsWith('/new')) ? ' active' : ''}`}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.label === 'Create new card' && <span className="sidebar-plus">+</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-account"><div className="account-avatar">{session?.user?.email?.slice(0, 1).toUpperCase() || 'A'}</div><div className="account-meta"><strong>Administrator</strong><span>{session?.user?.email}</span></div></div><button className="sidebar-logout" onClick={signOut}><Icon name="logout" size={18} /> Sign out</button></div>
    </aside><button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />
    <div className="admin-main"><header className="admin-topbar"><button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Icon name="menu" /></button><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{ADMIN_NAV.find((item) => item.to === window.location.pathname)?.label || (window.location.pathname.includes('/edit') ? 'Edit card' : 'Card details')}</strong></div><div className="topbar-right"><span className="secure-status"><i /> Secure workspace</span><div className="topbar-avatar">{session?.user?.email?.slice(0, 1).toUpperCase() || 'A'}</div></div></header><div className="admin-content">{children}</div></div>
  </div>
}

function PageTitle({ kicker = 'WORKSPACE', title, subtitle, action }) {
  return <div className="page-title"><div><span className="section-kicker">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="page-title-action">{action}</div>}</div>
}

function useCards() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function refresh() {
    setLoading(true)
    const { data, error: fetchError } = await requireSupabase().from('digital_cards').select('*').order('updated_at', { ascending: false })
    if (fetchError) setError(fetchError.message)
    else {
      setCards(data || [])
      setError('')
    }
    setLoading(false)
  }
  useEffect(() => {
    let active = true
    requireSupabase().from('digital_cards').select('*').order('updated_at', { ascending: false }).then(({ data, error: fetchError }) => {
      if (!active) return
      if (fetchError) setError(fetchError.message)
      else {
        setCards(data || [])
        setError('')
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [])
  return { cards, loading, error, refresh }
}

function DashboardPage() {
  const { cards, loading, error } = useCards()
  const [events, setEvents] = useState([])
  const [eventsError, setEventsError] = useState('')
  useEffect(() => {
    requireSupabase().rpc('admin_analytics', { days_back: 36500 }).then(({ data, error: queryError }) => {
      if (queryError) setEventsError(queryError.message)
      else setEvents(data || [])
    })
  }, [])
  const published = cards.filter((card) => card.status === 'published')
  const recent = cards.slice(0, 5)
  const viewsByCard = new Map()
  events.forEach((event) => viewsByCard.set(event.card_id, (viewsByCard.get(event.card_id) || 0) + Number(event.view_count)))
  const totalViews = events.reduce((total, event) => total + Number(event.view_count), 0)
  const stats = [
    ['Total digital cards', cards.length, 'cards', 'cards'],
    ['Published cards', published.length, 'live profiles', 'qr'],
    ['Draft cards', cards.length - published.length, 'in progress', 'grid'],
    ['Profile views', totalViews, 'recorded visits', 'chart'],
  ]
  return <><PageTitle title="Overview" subtitle="A clear view of your digital identity workspace." action={<Link className="button button-yellow" to="/admin/cards/new"><Icon name="plus" size={18} /> Create a card</Link>} />
    {(error || eventsError) && <div className="form-error">{error || eventsError}</div>}
    <div className="stat-grid">{stats.map(([label, value, hint, icon]) => <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon name={icon} size={18} /></span></div><strong>{loading ? '—' : value}</strong><small>{hint}</small></div>)}</div>
    <div className="dashboard-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent digital cards</h2><p>Your latest profile updates</p></div><Link to="/admin/cards">View all <Icon name="arrow" size={15} /></Link></div>
      {loading ? <div className="empty-small"><span className="spinner" />Loading cards…</div> : recent.length ? <div className="table-wrap"><table><thead><tr><th>PROFILE</th><th>STATUS</th><th>VIEWS</th><th>UPDATED</th><th /></tr></thead><tbody>{recent.map((card) => <tr key={card.id}><td><div className="table-person">{card.profile_image ? <MediaImage path={card.profile_image} alt="" /> : <span className="table-initial">{card.full_name?.slice(0, 1) || '?'}</span>}<span><strong>{card.full_name}</strong><small>{card.job_title || card.company || `/${card.slug}`}</small></span></div></td><td><StatusBadge status={card.status} /></td><td>{viewsByCard.get(card.id) || 0}</td><td>{formatDate(card.updated_at)}</td><td><Link className="icon-link" to={`/admin/cards/${card.id}/edit`} aria-label={`Edit ${card.full_name}`}><Icon name="arrow" size={16} /></Link></td></tr>)}</tbody></table></div> : <EmptyState icon="cards" title="Your workspace is ready" body="Create your first digital card to get started." action={<Link className="button button-yellow" to="/admin/cards/new">Create a card <Icon name="arrow" size={16} /></Link>} />}
    </section>    <section className="panel activity-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Keep things moving</p></div></div><div className="quick-actions"><Link to="/admin/cards/new"><span className="quick-icon"><Icon name="plus" /></span><span><strong>Create a digital card</strong><small>Add a new profile to your workspace</small></span><Icon name="arrow" size={16} /></Link><Link to="/admin/qr-codes"><span className="quick-icon"><Icon name="qr" /></span><span><strong>Browse QR codes</strong><small>Get share-ready codes for live cards</small></span><Icon name="arrow" size={16} /></Link><Link to="/admin/analytics"><span className="quick-icon"><Icon name="chart" /></span><span><strong>View analytics</strong><small>See how published profiles perform</small></span><Icon name="arrow" size={16} /></Link></div><div className="activity-note"><span className="activity-note-icon"><Icon name="stars" size={17} /></span><span><strong>{published.length ? `${published.length} profile${published.length === 1 ? '' : 's'} live` : 'Ready when you are'}</strong><small>{published.length ? 'Your published cards are ready to share.' : 'Publish a card to give it a public home.'}</small></span></div></section></div>
  </>
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{status === 'published' ? 'Published' : 'Draft'}</span>
}

function EmptyState({ icon = 'grid', title, body, action }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={25} /></div><h3>{title}</h3><p>{body}</p>{action}</div>
}

async function copyText(text) {
  if (!navigator.clipboard) throw new Error('Clipboard access is unavailable in this browser.')
  await navigator.clipboard.writeText(text)
}

function CardsPage() {
  const { cards, loading, error, refresh } = useCards()
  const { session } = useAuth()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('updated_at')
  const [toast, setToast] = useState('')
  const [viewCounts, setViewCounts] = useState({})
  useEffect(() => {
    requireSupabase().rpc('admin_analytics', { days_back: 36500 }).then(({ data, error: countError }) => {
      if (countError) console.error('Could not load profile view counts:', countError.message)
      else setViewCounts((data || []).reduce((counts, event) => {
        counts[event.card_id] = (counts[event.card_id] || 0) + Number(event.view_count)
        return counts
      }, {}))
    })
  }, [])
  const filtered = cards.filter((card) => {
    const text = `${card.full_name} ${card.company} ${card.slug}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (status === 'all' || card.status === status)
  }).sort((a, b) => sort === 'full_name'
    ? a.full_name.localeCompare(b.full_name)
    : String(b[sort] || '').localeCompare(String(a[sort] || '')))

  async function updateStatus(card, nextStatus) {
    const { error: updateError } = await requireSupabase().from('digital_cards').update({ status: nextStatus }).eq('id', card.id)
    if (updateError) window.alert(`Could not update card: ${updateError.message}`)
    else refresh()
  }
  async function duplicate(card) {
    const copy = { ...card }
    delete copy.id
    delete copy.created_at
    delete copy.updated_at
    const copiedImages = []
    for (const field of ['profile_image', 'company_logo', 'cover_image']) {
      const sourcePath = copy[field]
      if (!sourcePath || safeWebUrl(sourcePath)) continue
      const fileName = sourcePath.split('/').pop()
      const targetPath = `${session.user.id}/${crypto.randomUUID()}-${fileName}`
      const { error: copyError } = await requireSupabase().storage.from('card-media').copy(sourcePath, targetPath)
      if (copyError) {
        if (copiedImages.length) {
          const { error: cleanupError } = await requireSupabase().storage.from('card-media').remove(copiedImages)
          if (cleanupError) window.alert(`Image copy failed and temporary files could not be removed: ${cleanupError.message}`)
        }
        window.alert(`Could not duplicate the card's images: ${copyError.message}`)
        return
      }
      copiedImages.push(targetPath)
      copy[field] = targetPath
    }
    const slug = `${card.slug}-copy`
    const { error: insertError } = await requireSupabase().from('digital_cards').insert({ ...copy, slug, full_name: `${card.full_name} (copy)`, status: 'draft' })
    if (insertError) {
      if (copiedImages.length) {
        const { error: cleanupError } = await requireSupabase().storage.from('card-media').remove(copiedImages)
        if (cleanupError) window.alert(`Card duplication failed and copied images could not be removed: ${cleanupError.message}`)
      }
      window.alert(`Could not duplicate card: ${insertError.message}`)
    }
    else {
      setToast('Draft copy created.')
      refresh()
    }
  }
  async function remove(card) {
    if (!window.confirm(`Delete ${card.full_name}'s card? This action cannot be undone.`)) return
    const { error: deleteError } = await requireSupabase().from('digital_cards').delete().eq('id', card.id)
    if (deleteError) window.alert(`Could not delete card: ${deleteError.message}`)
    else {
      const imagePaths = [card.profile_image, card.company_logo, card.cover_image].filter((path) => path && !safeWebUrl(path))
      if (imagePaths.length) {
        const { error: cleanupError } = await requireSupabase().storage.from('card-media').remove(imagePaths)
        if (cleanupError) window.alert(`The card was deleted, but its private image files could not be removed: ${cleanupError.message}`)
      }
      refresh()
    }
  }
  async function copyUrl(slug) {
    try {
      await copyText(`${window.location.origin}/card/${slug}`)
      setToast('Public URL copied.')
    } catch (copyError) { window.alert(copyError.message) }
  }
  return <><PageTitle title="Digital cards" subtitle="Create and manage every profile in your workspace." action={<Link className="button button-yellow" to="/admin/cards/new"><Icon name="plus" size={18} /> Create a card</Link>} />
    {error && <div className="form-error">{error}</div>}
    <section className="panel cards-panel"><div className="filters-row"><label className="search-field"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, company, or slug…" /></label><div className="filter-controls"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Drafts</option></select><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort cards"><option value="updated_at">Recently updated</option><option value="created_at">Date created</option><option value="full_name">Name</option></select></div></div>
      {loading ? <div className="empty-small"><span className="spinner" />Loading cards…</div> : filtered.length ? <div className="table-wrap"><table className="cards-table"><thead><tr><th>PROFILE</th><th>PUBLIC URL</th><th>STATUS</th><th>VIEWS</th><th>UPDATED</th><th>ACTIONS</th></tr></thead><tbody>{filtered.map((card) => <tr key={card.id}><td><div className="table-person">{card.profile_image ? <MediaImage path={card.profile_image} alt="" /> : <span className="table-initial">{card.full_name?.slice(0, 1) || '?'}</span>}<span><strong>{card.full_name}</strong><small>{card.job_title || card.company || 'Digital profile'}</small></span></div></td><td><span className="slug-cell">/card/{card.slug}</span></td><td><StatusBadge status={card.status} /></td><td>{viewCounts[card.id] || 0}</td><td>{formatDate(card.updated_at)}</td><td><div className="row-actions"><Link className="icon-link" title="Edit card" to={`/admin/cards/${card.id}/edit`}><Icon name="settings" size={17} /></Link>{card.status === 'published' && <Link className="icon-link" title="Preview public card" target="_blank" rel="noreferrer" to={`/card/${card.slug}`}><Icon name="external" size={16} /></Link>}<button className="icon-link" title="Copy public URL" onClick={() => copyUrl(card.slug)}><Icon name="copy" size={16} /></button><button className="text-action" onClick={() => updateStatus(card, card.status === 'published' ? 'draft' : 'published')}>{card.status === 'published' ? 'Unpublish' : 'Publish'}</button><button className="text-action danger-action" onClick={() => remove(card)}>Delete</button><button className="text-action" onClick={() => duplicate(card)}>Duplicate</button></div></td></tr>)}</tbody></table></div> : <EmptyState icon="cards" title={query || status !== 'all' ? 'No matching cards' : 'No cards yet'} body={query || status !== 'all' ? 'Try a different search or filter.' : 'Create your first digital profile to get started.'} action={!query && status === 'all' && <Link className="button button-yellow" to="/admin/cards/new">Create a card <Icon name="arrow" size={16} /></Link>} />}
      <Toast message={toast} onClose={() => setToast('')} />
    </section>
  </>
}

function fieldSlug(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function shortProfileSlug(value) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  return fieldSlug(words.length > 1 ? `${words[0]} ${words[words.length - 1]}` : value)
}

function CardEditorPage({ editing = false }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [generatedDraftId] = useState(() => crypto.randomUUID())
  const draftId = editing ? id : (searchParams.get('draft') || generatedDraftId)
  const { session } = useAuth()
  const originalImages = useRef([])
  const uploadedImages = useRef([])
  const savedCard = useRef(null)
  const savedDraftState = useRef('')
  const baseUpdatedAt = useRef(null)
  const saving = useRef(false)
  const draftKey = `syntap:card-editor-draft:${editing ? `card:${id}` : `new:${draftId}`}`
  const [card, setCard] = useState(EMPTY_CARD)
  const [slugTouched, setSlugTouched] = useState(editing)
  const [loading, setLoading] = useState(editing)
  const [draftReady, setDraftReady] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [crop, setCrop] = useState(null)
  const latestDraft = useRef({ card, slugTouched })

  useEffect(() => {
    if (!editing && !searchParams.has('draft')) {
      setSearchParams({ draft: draftId }, { replace: true })
    }
  }, [draftId, editing, searchParams, setSearchParams])

  useEffect(() => {
    let active = true
    let draft = null
    try {
      const stored = sessionStorage.getItem(draftKey)
      if (stored) draft = JSON.parse(stored)
    } catch (storageError) {
      window.setTimeout(() => setDraftNotice(`Local draft storage is unavailable: ${storageError.message}. Your changes will remain in memory while this editor is open.`), 0)
    }

    const initialize = async () => {
      if (editing) {
        const { data, error: fetchError } = await requireSupabase().from('digital_cards').select('*').eq('id', id).single()
        if (!active) return
        if (fetchError) {
          setError(fetchError.message)
          setLoading(false)
          return
        }
        const normalized = {
          ...EMPTY_CARD,
          ...data,
          theme_settings: normalizedCardThemeSettings(data.theme_settings),
          section_settings: { ...DEFAULT_SECTIONS, ...data.section_settings },
          social_links: data.social_links || [],
          showcase_images: Array.isArray(data.showcase_images) ? data.showcase_images : [],
        }
        baseUpdatedAt.current = data.updated_at
        originalImages.current = [normalized.profile_image, normalized.company_logo, normalized.cover_image, ...normalized.showcase_images].filter(Boolean)
        const draftMatchesSavedVersion = draft?.baseUpdatedAt === data.updated_at
        if (draft?.version === 1 && draft.cardId === id && draft.card && draftMatchesSavedVersion) {
          const restored = {
            ...normalized,
            ...draft.card,
            theme_settings: normalizedCardThemeSettings(draft.card.theme_settings),
            section_settings: { ...DEFAULT_SECTIONS, ...draft.card.section_settings },
            social_links: Array.isArray(draft.card.social_links) ? draft.card.social_links : [],
            showcase_images: Array.isArray(draft.card.showcase_images) ? draft.card.showcase_images : [],
          }
          setCard(restored)
          setSlugTouched(Boolean(draft.slugTouched))
          setSuccess('Restored your unfinished local draft.')
          savedDraftState.current = JSON.stringify({ card: restored, slugTouched: Boolean(draft.slugTouched) })
        } else {
          setCard(normalized)
          savedDraftState.current = JSON.stringify({ card: normalized, slugTouched: true })
        }
        savedCard.current = normalized
        setLoading(false)
      } else {
        const initial = { ...EMPTY_CARD, theme_settings: { ...DEFAULT_THEME_SETTINGS }, section_settings: { ...DEFAULT_SECTIONS }, social_links: [], showcase_images: [] }
        if (draft?.version === 1 && draft.draftId === draftId && draft.card) {
          const restored = {
            ...initial,
            ...draft.card,
            theme_settings: normalizedCardThemeSettings(draft.card.theme_settings),
            section_settings: { ...DEFAULT_SECTIONS, ...draft.card.section_settings },
            social_links: Array.isArray(draft.card.social_links) ? draft.card.social_links : [],
            showcase_images: Array.isArray(draft.card.showcase_images) ? draft.card.showcase_images : [],
          }
          setCard(restored)
          setSlugTouched(Boolean(draft.slugTouched))
          setSuccess('Restored your unfinished local draft.')
          savedDraftState.current = JSON.stringify({ card: restored, slugTouched: Boolean(draft.slugTouched) })
        } else {
          setCard(initial)
          savedDraftState.current = JSON.stringify({ card: initial, slugTouched: false })
        }
        savedCard.current = initial
      }
      if (active) setDraftReady(true)
    }
    initialize().catch((loadError) => {
      if (active) {
        setError(`Could not load this card: ${loadError.message}`)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [draftKey, draftId, id, editing])

  useEffect(() => {
    if (!draftReady) return undefined
    const current = JSON.stringify({ card, slugTouched })
    if (current === savedDraftState.current) return undefined
    const timeout = window.setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify({
          version: 1,
          cardId: editing ? id : null,
          draftId: editing ? null : draftId,
          baseUpdatedAt: editing ? baseUpdatedAt.current : null,
          card,
          slugTouched,
          savedAt: Date.now(),
        }))
        setDraftNotice('')
      } catch (storageError) {
        setDraftNotice(`Could not save a local draft: ${storageError.message}. Your changes remain in memory until you leave this editor.`)
      }
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [card, draftReady, draftId, draftKey, editing, id, slugTouched])

  useEffect(() => {
    latestDraft.current = { card, slugTouched }
  }, [card, slugTouched])

  useEffect(() => () => {
    const current = latestDraft.current
    if (!draftReady || JSON.stringify(current) === savedDraftState.current) return
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({
        version: 1,
        cardId: editing ? id : null,
        draftId: editing ? null : draftId,
        baseUpdatedAt: editing ? baseUpdatedAt.current : null,
        ...current,
        savedAt: Date.now(),
      }))
    } catch (storageError) {
      console.error('Could not flush the local card draft before leaving:', storageError.message)
    }
  }, [draftKey, draftReady, draftId, editing, id])

  useEffect(() => {
    if (!draftReady || JSON.stringify({ card, slugTouched }) === savedDraftState.current) return undefined
    const warnBeforeLeave = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeave)
    return () => window.removeEventListener('beforeunload', warnBeforeLeave)
  }, [card, draftReady, slugTouched])

  function update(key, value) {
    setCard((current) => {
      const next = { ...current, [key]: value }
      if (key === 'full_name' && !slugTouched) next.slug = shortProfileSlug(value)
      return next
    })
  }
  function useShortSlug() {
    const slug = shortProfileSlug(card.full_name)
    if (!slug) {
      setError('Add a full name before creating a short profile link.')
      return
    }
    setError('')
    setSlugTouched(true)
    update('slug', slug)
  }
  function updateTheme(key, value) {
    setCard((current) => ({ ...current, theme_settings: { ...current.theme_settings, [key]: value } }))
  }
  function updateSection(key, value) {
    setCard((current) => ({ ...current, section_settings: { ...current.section_settings, [key]: value } }))
  }
  async function uploadImage(event, field) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a JPEG, PNG, WebP, or GIF image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Images must be 5 MB or smaller.')
      return
    }
    setError('')
    setCrop({ file, field })
  }

  async function uploadShowcaseImage(event, replaceIndex = null) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a JPEG, PNG, WebP, or GIF image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Showcase images must be 5 MB or smaller.')
      return
    }
    if (replaceIndex === null && card.showcase_images.length >= 6) {
      setError('A showcase can contain up to six photos.')
      return
    }
    setBusy(true)
    setError('')
    const path = makeUploadPath(session.user.id, file)
    try {
      const { error: uploadError } = await requireSupabase().storage.from('card-media').upload(path, file, { upsert: false })
      if (uploadError) throw uploadError
      uploadedImages.current.push(path)
      setCard((current) => {
        const showcaseImages = [...current.showcase_images]
        if (replaceIndex === null) showcaseImages.push(path)
        else showcaseImages[replaceIndex] = path
        return { ...current, showcase_images: showcaseImages }
      })
    } catch (uploadError) {
      setError(`Showcase image upload failed: ${uploadError.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function applyCroppedImage(file, field) {
    if (file.size > 5 * 1024 * 1024) {
      setError('The cropped image is larger than 5 MB. Use a smaller source image or crop a smaller area.')
      setCrop(null)
      return
    }
    setBusy(true)
    setError('')
    const path = makeUploadPath(session.user.id, file)
    try {
      const { error: uploadError } = await requireSupabase().storage.from('card-media').upload(path, file, { upsert: false })
      if (uploadError) setError(uploadError.message)
      else {
        uploadedImages.current.push(path)
        update(field, path)
      }
    } catch (uploadError) {
      setError(`Image upload failed: ${uploadError.message}`)
    } finally {
      setBusy(false)
      setCrop(null)
    }
  }

  async function recropImage(field) {
    const path = card[field]
    if (!path) return
    setError('')
    try {
      let imageUrl = safeWebUrl(path)
      if (!imageUrl) {
        const { data, error: signedUrlError } = await requireSupabase().storage.from('card-media').createSignedUrl(path, 3600)
        if (signedUrlError) throw signedUrlError
        imageUrl = data.signedUrl
      }
      const response = await fetch(imageUrl)
      if (!response.ok) throw new Error(`Image download failed (${response.status}).`)
      const blob = await response.blob()
      const type = ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) ? blob.type : 'image/jpeg'
      const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
      setCrop({ field, file: new File([blob], `${field}.${extension}`, { type }) })
    } catch (imageError) {
      setError(`Could not open this image for cropping: ${imageError.message}`)
    }
  }

  async function removeImage(field) {
    const path = card[field]
    if (!path) return
    if (uploadedImages.current.includes(path)) {
      setBusy(true)
      try {
        const { error: removeError } = await requireSupabase().storage.from('card-media').remove([path])
        if (removeError) {
          setError(`Could not remove uploaded image: ${removeError.message}`)
          return
        }
        uploadedImages.current = uploadedImages.current.filter((item) => item !== path)
      } catch (removeError) {
        setError(`Could not remove uploaded image: ${removeError.message}`)
        return
      } finally {
        setBusy(false)
      }
    }
    update(field, '')
  }
  async function save(event, publish = false) {
    event?.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setSuccess('')
    const slug = fieldSlug(card.slug)
    try {
      if (!card.full_name.trim()) {
        setError('Add a full name before saving.')
        return
      }
      if (!slug) {
        setError('Choose a valid public URL slug.')
        return
      }
      if (card.map_url.trim() && !isGoogleMapsUrl(card.map_url)) {
        setError('Enter a valid Google Maps link, such as https://maps.google.com/...')
        return
      }
      const { data: existingSlug, error: slugError } = await requireSupabase().from('digital_cards').select('id').eq('slug', slug).maybeSingle()
      if (slugError) {
        setError(slugError.message)
        return
      }
      if (existingSlug && (!editing || existingSlug.id !== id)) {
        setError('That public URL is already in use. Choose another slug.')
        return
      }
      const payload = {
        ...card,
        slug,
        theme_settings: normalizedCardThemeSettings(card.theme_settings),
        status: publish ? 'published' : card.status,
        full_name: card.full_name.trim(),
      }
      const request = editing
        ? requireSupabase().from('digital_cards').update(payload).eq('id', id).select('id, updated_at').single()
        : requireSupabase().from('digital_cards').insert(payload).select('id, updated_at').single()
      const { data, error: saveError } = await request
      if (saveError) {
        const missingShowcaseColumn = /showcase_images/i.test(saveError.message)
          && ['PGRST204', '42703'].includes(saveError.code)
        setError(saveError.code === '23505'
          ? 'That public URL is already in use. Choose another slug.'
          : missingShowcaseColumn
            ? 'The database is missing Showcase support. In Supabase, run supabase/migrations/202610270001_add_showcase_images.sql, then save this card again.'
            : saveError.message)
        return
      }
      const currentImages = [card.profile_image, card.company_logo, card.cover_image, ...(card.showcase_images || [])].filter(Boolean)
      const obsoleteImages = [...new Set([...originalImages.current, ...uploadedImages.current])]
        .filter((path) => !currentImages.includes(path) && !safeWebUrl(path))
      if (obsoleteImages.length) {
        const { error: cleanupError } = await requireSupabase().storage.from('card-media').remove(obsoleteImages)
        if (cleanupError) setError(`Profile saved, but old image files could not be removed: ${cleanupError.message}`)
      }
      originalImages.current = currentImages
      uploadedImages.current = []
      savedCard.current = payload
      baseUpdatedAt.current = data.updated_at
      savedDraftState.current = JSON.stringify({ card: payload, slugTouched: true })
      setCard(payload)
      setSlugTouched(true)
      try {
        sessionStorage.removeItem(draftKey)
        setDraftNotice('')
      } catch (storageError) {
        setDraftNotice(`Profile saved, but the local draft could not be cleared: ${storageError.message}`)
      }
      if (!editing) {
        navigate(`/admin/cards/${data.id}/edit`, { replace: true })
      } else {
        setSuccess(publish
          ? 'Your profile is published.'
          : payload.status === 'published'
            ? 'Your published profile has been updated.'
            : 'Your draft has been saved.')
      }
    } catch (saveError) {
      setError(`Could not save the profile: ${saveError.message}`)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  function discardDraft() {
    if (!window.confirm('Discard this editor draft and restore the last saved profile?')) return
    try {
      sessionStorage.removeItem(draftKey)
      setDraftNotice('')
    } catch (storageError) {
      setDraftNotice(`Could not remove the local draft: ${storageError.message}`)
    }
    const restored = savedCard.current || { ...EMPTY_CARD, theme_settings: { ...DEFAULT_THEME_SETTINGS }, section_settings: { ...DEFAULT_SECTIONS }, social_links: [], showcase_images: [] }
    const slugWasTouched = editing
    setCard(restored)
    setSlugTouched(slugWasTouched)
    savedDraftState.current = JSON.stringify({ card: restored, slugTouched: slugWasTouched })
    setSuccess('Unfinished changes were discarded.')
  }
  const addSocial = () => setCard((current) => ({ ...current, social_links: [...current.social_links, { platform: 'LinkedIn', url: '', label: '' }] }))
  const updateSocial = (index, key, value) => setCard((current) => ({ ...current, social_links: current.social_links.map((item, i) => i === index ? { ...item, [key]: value } : item) }))
  const publicUrl = `${window.location.origin}/card/${fieldSlug(card.slug || 'your-name')}`
  const editorTheme = normalizedTheme(card.theme_settings.theme)
  if (loading) return <div className="empty-small"><span className="spinner" />Loading profile…</div>
  return <><PageTitle title={editing ? 'Edit digital card' : 'Create a digital card'} subtitle="Add profile details, contact links, and a personal touch." action={<Link className="button button-outline" to="/admin/cards">Cancel</Link>} />
    {error && <div className="form-error" role="alert">{error}</div>}{draftNotice && <div className="form-warning" role="status">{draftNotice}</div>}{success && <div className="form-success" role="status">{success} {card.status === 'published' && <Link target="_blank" rel="noreferrer" to={`/card/${card.slug}`}>View profile <Icon name="external" size={13} /></Link>}</div>}
    <form className="editor-grid" onSubmit={(event) => save(event, false)}>
      <fieldset className="editor-fieldset" disabled={busy}>
      <div className="editor-main">
        <section className="panel editor-panel"><div className="editor-section-heading"><span className="editor-section-icon">01</span><div><h2>Profile and About</h2><p>Introduce the person behind this profile and add its business location.</p></div></div>
          <div className="field-grid"><label className="field-full">Full name *<input value={card.full_name} onChange={(event) => update('full_name', event.target.value)} required maxLength="120" placeholder="e.g. Alex Santos" /></label><label>Professional title<input value={card.job_title} onChange={(event) => update('job_title', event.target.value)} maxLength="120" placeholder="e.g. Creative Director" /></label><label>Company or organization<input value={card.company} onChange={(event) => update('company', event.target.value)} maxLength="120" placeholder="e.g. Northstar Studio" /></label><label className="field-full">Short biography<textarea rows="4" maxLength="600" value={card.bio} onChange={(event) => update('bio', event.target.value)} placeholder="A few words about what you do and what matters to you." /></label><label className="field-full">Business location<input value={card.address} onChange={(event) => update('address', event.target.value)} placeholder="Street, city, country" /></label><label className="field-full">Google Maps link<input type="url" value={card.map_url} onChange={(event) => update('map_url', event.target.value)} placeholder="https://maps.google.com/..." /></label></div>
          <div className="upload-grid">{[['profile_image', 'Profile photo'], ['company_logo', 'Company logo (optional)'], ['cover_image', 'Cover photo (optional)']].map(([field, label]) => <div className="upload-field" key={field}><span>{label}</span><label className={`upload-box${card[field] ? ' has-image' : ''}`}>{card[field] ? <MediaImage path={card[field]} alt={`${label} preview`} /> : <><b><Icon name="plus" size={17} /></b><small>Upload and crop</small></>}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => uploadImage(event, field)} /></label>{card[field] && <div className="image-actions"><button type="button" className="text-action" disabled={busy} onClick={() => recropImage(field)}>Recrop</button><button type="button" className="text-action danger-action upload-remove" disabled={busy} onClick={() => removeImage(field)}>Remove image</button></div>}</div>)}</div>
        </section>
        <section className="panel editor-panel"><div className="editor-section-heading"><span className="editor-section-icon">02</span><div><h2>Contact information</h2><p>Only the contact actions with details will appear on the public profile.</p></div></div>
          <div className="field-grid"><label>Phone<input type="tel" value={card.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+1 555 000 0000" /></label><label>Email<input type="email" value={card.email} onChange={(event) => update('email', event.target.value)} placeholder="hello@example.com" /></label><label>WhatsApp number<input type="tel" value={card.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} placeholder="Include country code" /></label><label>Website<input type="url" value={card.website} onChange={(event) => update('website', event.target.value)} placeholder="https://example.com" /></label><label className="field-full">Booking or appointment URL<input type="url" value={card.booking_url} onChange={(event) => update('booking_url', event.target.value)} placeholder="https://..." /></label></div>
        </section>
        <section className="panel editor-panel"><div className="editor-section-heading"><span className="editor-section-icon">03</span><div><h2>Social profiles</h2><p>Enter each platform’s complete destination URL; messaging links are not guessed from usernames.</p></div><button type="button" className="button button-outline button-small" onClick={addSocial}><Icon name="plus" size={15} /> Add link</button></div>
          {card.social_links.length === 0 ? <p className="form-hint">No social links added yet.</p> : card.social_links.map((social, index) => <div className="social-row" key={`${index}-${social.platform}`}><select value={social.platform} onChange={(event) => updateSocial(index, 'platform', event.target.value)} aria-label="Social platform">{SOCIAL_PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}</select><input type="url" value={social.url} onChange={(event) => updateSocial(index, 'url', event.target.value)} placeholder="https://…" aria-label="Social profile URL" /><input value={social.label || ''} onChange={(event) => updateSocial(index, 'label', event.target.value)} placeholder="Display label (optional)" aria-label="Social display label" /><button type="button" className="remove-link" aria-label="Remove social link" onClick={() => setCard((current) => ({ ...current, social_links: current.social_links.filter((_, i) => i !== index) }))}><Icon name="close" size={14} /></button></div>)}
        </section>
        <section className="panel editor-panel"><div className="editor-section-heading"><span className="editor-section-icon">04</span><div><h2>Showcase</h2><p>Add up to six photos to highlight your work or business.</p></div></div>
          <p className="form-hint">{card.showcase_images.length} of 6 photos</p>
          {card.showcase_images.length > 0 && <div className="showcase-editor-grid">{card.showcase_images.map((path, index) => <div className="showcase-editor-item" key={`${path}-${index}`}><MediaImage path={path} alt={`Showcase photo ${index + 1}`} /><div className="showcase-editor-controls"><button type="button" className="text-action" disabled={busy || index === 0} onClick={() => setCard((current) => { const images = [...current.showcase_images]; [images[index - 1], images[index]] = [images[index], images[index - 1]]; return { ...current, showcase_images: images } })} aria-label={`Move photo ${index + 1} left`}><Icon name="leftArrow" size={14} /></button><button type="button" className="text-action" disabled={busy || index === card.showcase_images.length - 1} onClick={() => setCard((current) => { const images = [...current.showcase_images]; [images[index], images[index + 1]] = [images[index + 1], images[index]]; return { ...current, showcase_images: images } })} aria-label={`Move photo ${index + 1} right`}><Icon name="arrow" size={14} /></button><label className="text-action showcase-replace">Replace<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => uploadShowcaseImage(event, index)} /></label><button type="button" className="text-action danger-action" disabled={busy} onClick={() => { if (!window.confirm('Remove this showcase photo?')) return; setCard((current) => ({ ...current, showcase_images: current.showcase_images.filter((_, itemIndex) => itemIndex !== index) })) }}>Remove</button></div></div>)}</div>}
          {card.showcase_images.length < 6 && <label className="button button-outline button-small showcase-add"><Icon name="plus" size={15} /> Add photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => uploadShowcaseImage(event)} /></label>}
          <p className="form-hint">JPEG, PNG, WebP, or GIF; maximum 5 MB per photo. Reordering is saved with the card.</p>
        </section>
        <section className="panel editor-panel"><div className="editor-section-heading"><span className="editor-section-icon">05</span><div><h2>Public URL</h2><p>This short link is used by the profile, QR code, and NFC card.</p></div></div>
          <label>Profile URL slug<div className="slug-input"><span>/card/</span><input value={card.slug} onChange={(event) => { setSlugTouched(true); update('slug', fieldSlug(event.target.value)) }} placeholder="alex-santos" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></div></label><button type="button" className="button button-outline button-small slug-suggest" onClick={useShortSlug}><Icon name="link" size={15} /> Use short link</button><div className="public-url-preview"><span>PUBLIC URL PREVIEW</span><strong>{publicUrl}</strong></div><p className="form-hint slug-warning">Changing a published profile’s slug changes its URL. Previously shared links and printed QR codes using the old URL will no longer open this profile.</p>
        </section>
      </div>
      <aside className="editor-side">
        <section className="panel editor-panel appearance-editor">
          <div className="editor-section-heading"><span className="editor-section-icon">06</span><div><h2>Card appearance</h2><p>Choose an accent and style; SynTap adapts contrast for each theme.</p></div></div>
          <label>Theme<select value={editorTheme} onChange={(event) => updateTheme('theme', event.target.value)}><option value="light">Light</option><option value="dark">Dark</option><option value="liquid-glass">Liquid Glass</option></select></label>
          <label>Profile layout<select value={card.theme_settings.profile_layout === 'large-profile' ? 'large-profile' : 'standard'} onChange={(event) => updateTheme('profile_layout', event.target.value)}><option value="standard">Standard</option><option value="large-profile">Large Profile</option></select></label>
          <label className="accent-color-control">Accent color<input type="color" value={card.theme_settings.primary} onChange={(event) => updateTheme('primary', event.target.value)} /></label>
          <label>Button style<select value={normalizedButtonStyle(card.theme_settings.button_appearance)} onChange={(event) => updateTheme('button_appearance', event.target.value)}><option value="soft">Soft</option><option value="outline">Outline</option><option value="glass">Liquid Glass</option></select></label>
          <label>Button shape<select value={card.theme_settings.button_shape === 'pill' ? 'pill' : 'rounded'} onChange={(event) => updateTheme('button_shape', event.target.value)}><option value="rounded">Rounded</option><option value="pill">Pill</option></select></label>
          <div className="button-layout-setting"><span>Button layout</span><div className="button-layout-options" role="radiogroup" aria-label="Button layout">
            {['default', 'two-column'].map((layout) => <button key={layout} type="button" className={`button-layout-option${(card.theme_settings.button_layout || 'default') === layout ? ' selected' : ''}`} role="radio" aria-checked={(card.theme_settings.button_layout || 'default') === layout} onClick={() => updateTheme('button_layout', layout)}>
              <span className={`button-layout-preview preview-layout-${layout}`}><i /><i /><i /></span><strong>{layout === 'default' ? 'Default' : 'Two-Column'}</strong>
            </button>)}
          </div></div>
        </section>
        <section className="panel editor-panel live-preview-panel">
          <div className="editor-section-heading"><span className="editor-section-icon"><Icon name="external" size={14} /></span><div><h2>Live preview</h2><p>Updates as you edit this profile.</p></div></div>
          <div className={`editor-card-preview editor-theme-${editorTheme}${card.theme_settings.alignment === 'left' ? ' editor-preview-left' : ''}${card.theme_settings.profile_layout === 'large-profile' ? ' editor-profile-large' : ''}`} style={{ '--card-accent': card.theme_settings.primary, '--card-accent-icon': accessibleAccent(card.theme_settings.primary, editorTheme), '--accent-foreground': readableTextColor(card.theme_settings.primary) }}>
            <div className={`editor-preview-cover${card.cover_image ? ' editor-preview-has-cover' : ''}`}>{card.cover_image && <MediaImage path={card.cover_image} alt="" />}</div>
            <div className="editor-preview-content">
              {card.theme_settings.profile_layout === 'large-profile' ? <div className="editor-preview-hero">
                <div className="editor-preview-avatar">{card.profile_image ? <MediaImage path={card.profile_image} alt="" /> : <span>{card.full_name.slice(0, 1) || '?'}</span>}</div>
              </div> : <>
                <div className="editor-preview-avatar">{card.profile_image ? <MediaImage path={card.profile_image} alt="" /> : <span>{card.full_name.slice(0, 1) || '?'}</span>}</div>
                <strong>{card.full_name || 'Your name'}</strong>{card.job_title && <small>{card.job_title}</small>}{card.company && <b>{card.company}</b>}
              </>}
              {card.theme_settings.profile_layout === 'large-profile' && <div className="editor-preview-identity">
                <strong>{card.full_name || 'Your name'}</strong>
                {card.job_title && <span className="editor-preview-identity-row">{card.job_title}</span>}
                {card.company && <span className="editor-preview-identity-row editor-preview-company">{card.company}</span>}
              </div>}
              {card.bio && card.theme_settings.profile_layout !== 'large-profile' && <p>{card.bio}</p>}
              <div className={`editor-preview-actions preview-style-${normalizedButtonStyle(card.theme_settings.button_appearance)}${card.theme_settings.button_layout === 'two-column' ? ' editor-preview-two-column' : ''}${card.theme_settings.button_shape === 'pill' ? ' editor-preview-shape-pill' : ''}`}><span className="editor-preview-button preview-primary">Save contact</span><span className="editor-preview-button">Call</span><span className="editor-preview-button">Email</span><span className="editor-preview-button">Website</span></div>
            </div>
          </div>
        </section>
        <section className="panel editor-panel"><div className="editor-section-heading"><span className="editor-section-icon">07</span><div><h2>Profile sections</h2><p>Choose which optional sections appear.</p></div></div>
          {Object.entries({ about: 'About', contact: 'Contact details', social: 'Social profiles', location: 'Business location', booking: 'Booking', showcase: 'Showcase' }).map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(card.section_settings[key])} onChange={(event) => updateSection(key, event.target.checked)} /></label>)}
        </section>
        <section className="publish-card"><span className="publish-dot" /><strong>{card.status === 'published' ? 'Published profile' : 'Saved as draft'}</strong><p>{card.status === 'published' ? 'Your card is publicly available at its unique URL.' : 'Only published cards can be viewed by visitors.'}</p><button type="button" className="button button-yellow full-button" disabled={busy || !card.full_name} onClick={(event) => save(event, true)}>{busy ? 'Saving…' : card.status === 'published' ? 'Save and publish' : 'Publish profile'} <Icon name="arrow" size={16} /></button><button type="submit" className="button button-outline full-button" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button><button type="button" className="text-action danger-action discard-draft" disabled={busy} onClick={discardDraft}>Discard unsaved changes</button><small className="draft-storage-note">Text and uploaded image references are saved in this browser session. If an image upload has not completed, select it again after a reload.</small></section>
      </aside>
      </fieldset>
    </form>
    {crop && <ImageCropDialog file={crop.file} field={crop.field} onCancel={() => setCrop(null)} onApply={(file) => applyCroppedImage(file, crop.field)} />}
  </>
}

async function makeVcard(card) {
  const escape = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
  const family = card.full_name?.split(' ').slice(-1)[0] || ''
  const given = card.full_name?.split(' ').slice(0, -1).join(' ') || ''
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escape(family)};${escape(given)};;;`, `FN:${escape(card.full_name)}`]
  if (card.company) lines.push(`ORG:${escape(card.company)}`)
  if (card.job_title) lines.push(`TITLE:${escape(card.job_title)}`)
  if (card.phone) lines.push(`TEL;TYPE=CELL:${escape(card.phone)}`)
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${escape(card.email)}`)
  if (card.website) lines.push(`URL:${escape(card.website)}`)
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${escape(card.address)};;;;`)
  lines.push('END:VCARD')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  link.href = url
  if (isIos) link.target = '_blank'
  else link.download = `${fieldSlug(card.full_name || 'contact')}.vcf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function safeWebUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

function isGoogleMapsUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'maps.app.goo.gl') return true
    if (hostname === 'goo.gl') return /^\/maps(?:\/|$)/.test(url.pathname)
    if (/^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(hostname)) return true
    const googleHost = hostname.replace(/^www\./, '')
    return (googleHost === 'google.com' || /^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(googleHost))
      && /^\/maps(?:\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

function relativeLuminance(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || '')
  if (!match) return 1
  const channels = match[1].match(/../g).map((channel) => parseInt(channel, 16) / 255)
  const linear = channels.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
}

function readableTextColor(background) {
  return relativeLuminance(background) > .179 ? '#111827' : '#ffffff'
}

function accessibleAccent(accent, theme) {
  const surface = theme === 'dark' ? '#202630' : '#ffffff'
  const contrast = (first, second) => {
    const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a)
    return (light + .05) / (dark + .05)
  }
  if (contrast(accent, surface) >= 3) return accent
  const target = readableTextColor(surface)
  const source = accent.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16))
  const destination = target === '#ffffff' ? [255, 255, 255] : [17, 24, 39]
  for (let amount = .05; amount <= 1; amount += .05) {
    const candidate = `#${source.map((channel, index) => Math.round(channel + (destination[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`
    if (contrast(candidate, surface) >= 3) return candidate
  }
  return target
}

function normalizedTheme(theme) {
  if (theme === 'dark') return 'dark'
  if (theme === 'liquid-glass') return 'liquid-glass'
  return 'light'
}

function normalizedButtonStyle(style) {
  if (style === 'glass') return 'glass'
  if (style === 'outline') return 'outline'
  return 'soft'
}

function normalizedCardThemeSettings(settings = {}) {
  return {
    ...DEFAULT_THEME_SETTINGS,
    theme: normalizedTheme(settings.theme),
    primary: /^#[0-9a-f]{6}$/i.test(settings.primary || '') ? settings.primary : DEFAULT_THEME_SETTINGS.primary,
    button_appearance: normalizedButtonStyle(settings.button_appearance),
    button_shape: settings.button_shape === 'pill' ? 'pill' : 'rounded',
    alignment: settings.alignment === 'left' ? 'left' : 'center',
    button_layout: settings.button_layout === 'two-column' ? 'two-column' : 'default',
    profile_layout: settings.profile_layout === 'large-profile' ? 'large-profile' : 'standard',
  }
}

function socialBrand(platform) {
  const brands = {
    facebook: { icon: 'facebook', color: '#1877f2' },
    instagram: { icon: 'instagram', color: '#c13584' },
    linkedin: { icon: 'linkedin', color: '#0a66c2' },
    tiktok: { icon: 'tiktok', color: '#111111', darkColor: '#ffffff' },
    youtube: { icon: 'youtube', color: '#ff0000' },
    x: { icon: 'twitter', color: '#111111', darkColor: '#ffffff' },
    github: { icon: 'github', color: '#24292f', darkColor: '#ffffff' },
    whatsapp: { icon: 'whatsapp', color: '#25d366' },
    viber: { icon: 'link', color: '#7360f2' },
    telegram: { icon: 'telegram', color: '#229ed9' },
    messenger: { icon: 'messenger', color: '#0084ff' },
    discord: { icon: 'discord', color: '#5865f2' },
    wechat: { icon: 'wechat', color: '#07c160' },
    line: { icon: 'line', color: '#06c755' },
    slack: { icon: 'slack', color: '#611f69' },
    skype: { icon: 'skype', color: '#00aff0' },
    signal: { icon: 'signal', color: '#3a76f0' },
    behance: { icon: 'behance', color: '#1769ff' },
    dribbble: { icon: 'dribbble', color: '#ea4c89' },
    calendly: { icon: 'calendar', color: '#006bff' },
  }
  return brands[String(platform || '').toLowerCase()] || { icon: 'link', color: '#555555' }
}

function PublicCardPage() {
  const { slug } = useParams()
  const [card, setCard] = useState(null)
  const [loadedCoverPath, setLoadedCoverPath] = useState('')
  const [showcaseIndex, setShowcaseIndex] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    document.title = 'Digital profile'
    return () => { document.title = 'SynTap' }
  }, [])
  useEffect(() => {
    let active = true
    if (!supabase) return () => { active = false }
    let requestInProgress = false
    let initialViewRecorded = false
    let hasLoadedCard = false

    async function refreshCard() {
      if (requestInProgress || !active) return
      requestInProgress = true
      try {
        const { data, error: fetchError } = await requireSupabase()
          .from('digital_cards')
          .select('*')
          .eq('slug', slug)
          .eq('status', 'published')
          .maybeSingle()
        if (!active) return
        if (fetchError) {
          if (hasLoadedCard) setNotice(`Could not refresh the latest profile: ${fetchError.message}`)
          else setError(fetchError.message)
          return
        }
        if (!data) {
          hasLoadedCard = false
          setCard(null)
          setError('This digital card could not be found.')
          return
        }
        hasLoadedCard = true
        setCard(data)
        setError('')
        if (!initialViewRecorded) {
          initialViewRecorded = true
          const ref = new URLSearchParams(window.location.search).get('via')
          const attribution = ['qr', 'nfc'].includes(ref) ? ref : 'direct'
          const { error: viewError } = await requireSupabase().rpc('record_profile_view', { profile_slug: slug, attribution })
          if (viewError) console.error('Profile view was not recorded:', viewError.message)
        }
      } catch (fetchError) {
        if (!active) return
        if (hasLoadedCard) setNotice(`Could not refresh the latest profile: ${fetchError.message}`)
        else setError(fetchError.message)
      } finally {
        requestInProgress = false
        if (active) setLoading(false)
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshCard()
    }
    void refreshCard()
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('pageshow', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const channel = requireSupabase()
      .channel(`public-card-${slug}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'digital_cards',
        filter: `slug=eq.${slug}`,
      }, refreshCard)
      .subscribe()

    return () => {
      active = false
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('pageshow', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      requireSupabase().removeChannel(channel)
    }
  }, [slug])
  useEffect(() => {
    if (card) document.title = `${card.full_name}${card.company ? ` · ${card.company}` : ''}`
  }, [card])
  useEffect(() => {
    if (showcaseIndex === null) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowcaseIndex(null)
      if (event.key === 'ArrowLeft') setShowcaseIndex((index) => (index + (card.showcase_images.length - 1)) % card.showcase_images.length)
      if (event.key === 'ArrowRight') setShowcaseIndex((index) => (index + 1) % card.showcase_images.length)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showcaseIndex, card])
  async function share() {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: card.full_name, text: `Connect with ${card.full_name}`, url })
        setNotice('Profile shared.')
      }
      else {
        await copyText(url)
        setNotice('Profile link copied.')
      }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setNotice(`Sharing failed: ${shareError.message}`)
    }
  }
  if (loading) return <div className="full-loader"><span className="spinner" />Loading profile…</div>
  if (error || !card) return <div className="not-found"><span className="section-kicker">PROFILE NOT AVAILABLE</span><h1>This card isn't here.</h1><p>{!supabase ? 'This profile service is not connected yet.' : error || 'This digital card could not be found.'}</p></div>
  const sections = { ...DEFAULT_SECTIONS, ...card.section_settings }
  const theme = normalizedCardThemeSettings(card.theme_settings || {})
  const website = safeWebUrl(card.website)
  const mapUrl = isGoogleMapsUrl(card.map_url)
    ? safeWebUrl(card.map_url)
    : card.address.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address.trim())}` : null
  const locationLabel = card.address.trim()
  const booking = safeWebUrl(card.booking_url)
  const whatsapp = card.whatsapp?.replace(/\D/g, '')
  const phoneNumber = card.phone?.replace(/[^\d+]/g, '')
  const socials = (card.social_links || []).filter((item) => safeWebUrl(item.url))
  const showcaseImages = Array.isArray(card.showcase_images) ? card.showcase_images : []
  const themeName = normalizedTheme(theme.theme)
  const buttonStyle = normalizedButtonStyle(theme.button_appearance)
  const buttonShape = theme.button_shape === 'pill' ? 'pill' : 'rounded'
  const largeProfile = theme.profile_layout === 'large-profile'
  const themeAccent = accessibleAccent(theme.primary || DEFAULT_THEME_SETTINGS.primary, themeName)
  const style = {
    '--card-accent': theme.primary || DEFAULT_THEME_SETTINGS.primary,
    '--card-accent-icon': themeAccent,
    '--accent-foreground': readableTextColor(theme.primary || DEFAULT_THEME_SETTINGS.primary),
  }
  const hasCover = Boolean(card.cover_image?.trim() && loadedCoverPath === card.cover_image)
  return <div className={`public-card-page public-theme-${themeName}${themeName === 'dark' ? ' public-dark' : ''}`} style={style}>
    <div className={`public-card-wrap${largeProfile ? ' public-card-wrap-large' : ''}`}><article className={`public-profile public-button-${buttonStyle} public-button-shape-${buttonShape}${theme.button_layout === 'two-column' ? ' public-layout-two-column' : ''}${largeProfile ? ' public-profile-large' : ''}${hasCover ? ' has-cover' : ' no-cover'}${theme.alignment === 'left' ? ' align-left' : ''}`}>
      {card.cover_image?.trim() && <PublicCover key={card.cover_image} path={card.cover_image} alt={`${card.full_name} cover`} onLoad={() => setLoadedCoverPath(card.cover_image)} onError={() => setLoadedCoverPath('')} />}
      <div className="public-profile-body">{largeProfile ? <>
        <div className="public-profile-hero"><PublicProfilePhoto path={card.profile_image} name={card.full_name} /></div>
        <div className="public-profile-identity"><h1>{card.full_name}</h1>{(card.job_title || card.company) && <div className="public-identity-meta">
          {card.job_title && <div className="public-identity-detail"><p className="public-job">{card.job_title}</p></div>}
          {card.company && <div className="public-identity-detail"><p className="public-company">{card.company}</p></div>}
        </div>}</div>
      </> : <>
        <PublicProfilePhoto path={card.profile_image} name={card.full_name} />
        <h1>{card.full_name}</h1>{(card.job_title || card.company) && <div className="public-identity-meta">{card.job_title && <p className="public-job">{card.job_title}</p>}{card.company && <p className="public-company">{card.company}</p>}</div>}
      </>}
        {card.company_logo && <MediaImage className="company-logo" path={card.company_logo} alt={card.company || 'Company logo'} />}
        {!largeProfile && sections.about && card.bio && <p className="public-bio">{card.bio}</p>}
        <div className={`public-actions${theme.button_layout === 'two-column' ? ' public-actions-two-column' : ''}`}>
          <button className="public-action public-primary-action" onClick={() => makeVcard(card)}><span className="public-action-icon"><Icon name="personPlus" size={18} /></span><span className="public-action-copy"><strong>Save contact</strong><small>Add {card.full_name} to your contacts</small></span><Icon name="arrow" size={16} /></button>
          {sections.contact && phoneNumber && <a className="public-action" href={`tel:${phoneNumber}`}><span className="public-action-icon"><Icon name="phone" size={18} /></span><span className="public-action-copy"><strong>Call</strong><small>{card.phone}</small></span><Icon name="arrow" size={16} /></a>}
          {sections.contact && phoneNumber && <a className="public-action" href={`sms:${phoneNumber}`}><span className="public-action-icon"><Icon name="sms" size={18} /></span><span className="public-action-copy"><strong>Text / SMS</strong><small>Message {card.full_name}</small></span><Icon name="arrow" size={16} /></a>}
          {sections.contact && card.email && <a className="public-action" href={`mailto:${card.email}`}><span className="public-action-icon"><Icon name="email" size={18} /></span><span className="public-action-copy"><strong>Email</strong><small>{card.email}</small></span><Icon name="arrow" size={16} /></a>}
          {sections.contact && card.whatsapp && whatsapp && <a className="public-action" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><span className="public-action-icon"><Icon name="whatsapp" size={18} /></span><span className="public-action-copy"><strong>WhatsApp</strong><small>Message {card.full_name}</small></span><Icon name="arrow" size={16} /></a>}
          {sections.contact && website && <a className="public-action" href={website} target="_blank" rel="noopener noreferrer"><span className="public-action-icon"><Icon name="external" size={18} /></span><span className="public-action-copy"><strong>Visit website</strong><small>{new URL(website).hostname}</small></span><Icon name="arrow" size={16} /></a>}
          {sections.booking && booking && <a className="public-action" href={booking} target="_blank" rel="noopener noreferrer"><span className="public-action-icon"><Icon name="calendar" size={18} /></span><span className="public-action-copy"><strong>Book an appointment</strong><small>Choose a time to connect</small></span><Icon name="arrow" size={16} /></a>}
          {sections.location && (locationLabel || mapUrl) && <a className="public-action" href={mapUrl} target="_blank" rel="noopener noreferrer"><span className="public-action-icon"><Icon name="location" size={18} /></span><span className="public-action-copy"><strong>Get directions</strong><small>{locationLabel || 'Open business location in Google Maps'}</small></span><Icon name="arrow" size={16} /></a>}
        </div>
        {sections.social && socials.length > 0 && <section className={`public-social-list${theme.button_layout === 'two-column' ? ' public-social-two-column' : ''}`} aria-label="Social media and links"><h2 className="public-actions-title">Connect With Me</h2><p className="public-actions-hint">Choose a platform to connect with {card.full_name}.</p>{socials.map((social, index) => {
          const brand = socialBrand(social.platform)
          const socialColor = themeName === 'dark' ? (brand.darkColor || brand.color) : brand.color
          return <a key={`${social.platform}-${index}`} className="public-action public-social-action" style={{ '--social-color': socialColor }} href={safeWebUrl(social.url)} target="_blank" rel="noopener noreferrer"><span className="public-action-icon public-social-icon"><Icon name={brand.icon} size={19} /></span><span className="public-action-copy"><strong>{social.label || social.platform}</strong><small>Open {social.platform} link</small></span><Icon name="arrow" size={16} /></a>
        })}</section>}
        {sections.showcase && showcaseImages.length > 0 && <section className="public-showcase" aria-label="Showcase gallery"><h2 className="public-actions-title">Showcase</h2><div className="public-showcase-grid">{showcaseImages.map((path, index) => <button type="button" className="public-showcase-photo" key={`${path}-${index}`} onClick={() => setShowcaseIndex(index)} aria-label={`View showcase photo ${index + 1}`}><MediaImage path={path} alt={`${card.full_name} showcase ${index + 1}`} /></button>)}</div></section>}
        <button className="public-action public-share-action" onClick={share}><span className="public-action-icon"><Icon name="share" size={16} /></span><span className="public-action-copy"><strong>Share profile</strong><small>Send this profile to someone</small></span><Icon name="arrow" size={14} /></button>
      </div>
    </article></div>
    {showcaseIndex !== null && showcaseImages[showcaseIndex] && <div className="showcase-lightbox" role="dialog" aria-modal="true" aria-label={`Showcase photo ${showcaseIndex + 1} of ${showcaseImages.length}`} onClick={() => setShowcaseIndex(null)}><button type="button" className="showcase-lightbox-close" onClick={() => setShowcaseIndex(null)} aria-label="Close photo viewer"><Icon name="close" size={22} /></button>{showcaseImages.length > 1 && <button type="button" className="showcase-lightbox-nav previous" aria-label="Previous photo" onClick={(event) => { event.stopPropagation(); setShowcaseIndex((showcaseIndex + showcaseImages.length - 1) % showcaseImages.length) }}><Icon name="leftArrow" size={22} /></button>}<MediaImage className="showcase-lightbox-image" path={showcaseImages[showcaseIndex]} alt={`${card.full_name} showcase ${showcaseIndex + 1}`} onClick={(event) => event.stopPropagation()} />{showcaseImages.length > 1 && <button type="button" className="showcase-lightbox-nav next" aria-label="Next photo" onClick={(event) => { event.stopPropagation(); setShowcaseIndex((showcaseIndex + 1) % showcaseImages.length) }}><Icon name="arrow" size={22} /></button>}</div>}
    <Toast message={notice} onClose={() => setNotice('')} />
  </div>
}

function QrCodesPage() {
  const { cards, loading, error } = useCards()
  const [selected, setSelected] = useState(null)
  const [qrUrl, setQrUrl] = useState('')
  const [qrSvg, setQrSvg] = useState('')
  const [qrError, setQrError] = useState('')
  const [toast, setToast] = useState('')
  const [nfcTags, setNfcTags] = useState([])
  const [tagIdentifier, setTagIdentifier] = useState('')
  const [tagNotes, setTagNotes] = useState('')
  const [nfcError, setNfcError] = useState('')
  const published = cards.filter((card) => card.status === 'published')
  useEffect(() => {
    if (!selected) return
    let active = true
    const url = `${window.location.origin}/card/${selected.slug}?via=qr`
    Promise.all([
      QRCode.toDataURL(url, { width: 420, margin: 2, color: { dark: '#171717', light: '#ffffff' }, errorCorrectionLevel: 'H' }),
      QRCode.toString(url, { type: 'svg', width: 420, margin: 2, errorCorrectionLevel: 'H' }),
      requireSupabase().from('nfc_tags').select('*').eq('card_id', selected.id).order('created_at', { ascending: false }),
    ])
      .then(([pngUrl, svg, tagsResult]) => {
        if (!active) return
        if (tagsResult.error) setNfcError(tagsResult.error.message)
        else setNfcTags(tagsResult.data || [])
        setQrUrl(pngUrl)
        setQrSvg(svg)
        setQrError('')
      })
      .catch((error) => { if (active) setQrError(error.message) })
    return () => { active = false }
  }, [selected])
  function downloadQr() {
    if (!qrUrl || !selected) return
    const link = document.createElement('a')
    link.href = qrUrl
    link.download = `${selected.slug}-syntap-qr.png`
    link.click()
  }
  function downloadSvg() {
    if (!qrSvg || !selected) return
    const url = URL.createObjectURL(new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${selected.slug}-syntap-qr.svg`
    link.click()
    URL.revokeObjectURL(url)
  }
  async function addNfcTag(event) {
    event.preventDefault()
    if (!tagIdentifier.trim()) {
      setNfcError('Enter an NFC tag identifier or inventory code.')
      return
    }
    const { data, error: insertError } = await requireSupabase().from('nfc_tags')
      .insert({ card_id: selected.id, tag_identifier: tagIdentifier.trim(), notes: tagNotes.trim() })
      .select('*')
      .single()
    if (insertError) setNfcError(insertError.code === '23505' ? 'That NFC tag identifier is already registered.' : insertError.message)
    else {
      setNfcTags((current) => [data, ...current])
      setTagIdentifier('')
      setTagNotes('')
      setNfcError('')
    }
  }
  async function reassignNfcTag(tag, cardId) {
    const { error: updateError } = await requireSupabase().from('nfc_tags').update({ card_id: cardId }).eq('id', tag.id)
    if (updateError) setNfcError(updateError.message)
    else setNfcTags((current) => current.map((item) => item.id === tag.id ? { ...item, card_id: cardId } : item))
  }
  return <>
    <PageTitle title="QR codes" subtitle="Generate share-ready QR codes for published profiles." />
    {error && <div className="form-error">{error}</div>}
    {loading ? <div className="empty-small"><span className="spinner" />Loading published cards…</div> : published.length === 0 ? <section className="panel"><EmptyState icon="qr" title="No published profiles yet" body="Publish a digital card before generating its QR code." action={<Link className="button button-yellow" to="/admin/cards">Go to digital cards <Icon name="arrow" size={16} /></Link>} /></section> : <div className="qr-layout">
      <section className="panel qr-list"><div className="panel-heading"><div><h2>Published profiles</h2><p>Select a profile to generate its QR code.</p></div></div>{published.map((card) => <button key={card.id} className={`qr-card-row${selected?.id === card.id ? ' selected' : ''}`} onClick={() => { setQrUrl(''); setQrSvg(''); setNfcTags([]); setSelected(card) }}><span className="table-initial">{card.full_name?.slice(0, 1)}</span><span><strong>{card.full_name}</strong><small>/card/{card.slug}</small></span><Icon name="arrow" size={16} /></button>)}</section>
      <section className="panel qr-preview-panel">{selected ? <>
        <div className="panel-heading"><div><h2>QR preview</h2><p>Plain, high-contrast code for reliable scanning.</p></div></div>
        {qrError ? <div className="form-error">{qrError}</div> : qrUrl ? <div className="qr-code-frame"><img src={qrUrl} alt={`QR code for ${selected.full_name}`} /><strong>{selected.full_name}</strong><span>{window.location.origin}/card/{selected.slug}</span></div> : <div className="empty-small"><span className="spinner" />Generating QR code…</div>}
        <div className="qr-actions">
          <button className="button button-yellow" onClick={downloadQr} disabled={!qrUrl}>Download PNG <Icon name="download" size={15} /></button>
          <button className="button button-outline" onClick={downloadSvg} disabled={!qrSvg}>Download SVG <Icon name="download" size={15} /></button>
          <button className="button button-outline" onClick={async () => { try { await copyText(`${window.location.origin}/card/${selected.slug}`); setToast('Public URL copied.') } catch (copyError) { setQrError(copyError.message) } }}>Copy public URL <Icon name="copy" size={16} /></button>
        </div>
        <div className="nfc-instructions"><span className="nfc-icon"><Icon name="nfc" size={18} /></span><span><strong>Program an NFC card</strong><small>Use a compatible device to write this URL to the physical tag. SynTap does not write to NFC hardware.</small></span><button className="text-action" onClick={async () => { try { await copyText(`${window.location.origin}/card/${selected.slug}?via=nfc`); setToast('NFC-attributed profile URL copied.') } catch (copyError) { setNfcError(copyError.message) } }}>Copy NFC URL</button></div>
        {nfcError && <div className="form-error nfc-error">{nfcError}</div>}
        <div className="nfc-manager">
          <h3>NFC tag inventory</h3>
          <p>Record inventory codes and reassign a registered tag when needed.</p>
          <form className="nfc-form" onSubmit={addNfcTag}><input value={tagIdentifier} onChange={(event) => setTagIdentifier(event.target.value)} maxLength="100" placeholder="Tag identifier or inventory code" aria-label="NFC tag identifier" required /><input value={tagNotes} onChange={(event) => setTagNotes(event.target.value)} maxLength="250" placeholder="Notes (optional)" aria-label="NFC tag notes" /><button className="button button-outline button-small" type="submit">Record tag <Icon name="plus" size={14} /></button></form>
          {nfcTags.length > 0 && <div className="nfc-tag-list">{nfcTags.map((tag) => <div className="nfc-tag-row" key={tag.id}><span><strong>{tag.tag_identifier}</strong><small>{tag.notes || 'No notes'}</small></span><select aria-label={`Assign ${tag.tag_identifier} to profile`} value={tag.card_id} onChange={(event) => reassignNfcTag(tag, event.target.value)}>{published.map((card) => <option key={card.id} value={card.id}>{card.full_name}</option>)}</select></div>)}</div>}
        </div>
      </> : <EmptyState icon="qr" title="Choose a profile" body="Select a published card to preview and download its QR code." />}<Toast message={toast} onClose={() => setToast('')} /></section>
    </div>}
  </>
}

function buildDailyViews(events, range) {
  const chartDays = range === '7' ? 7 : range === '90' ? 30 : 14
  const dailyViews = Array.from({ length: chartDays }, (_, index) => {
    const day = new Date()
    day.setUTCHours(0, 0, 0, 0)
    day.setUTCDate(day.getUTCDate() - (chartDays - index - 1))
    const dayKey = day.toISOString().slice(0, 10)
    return {
      label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(day),
      count: events.filter((event) => event.view_date === dayKey).reduce((total, event) => total + Number(event.view_count), 0),
    }
  })
  return { chartDays, dailyViews }
}

function AnalyticsPage() {
  const [events, setEvents] = useState([])
  const [dailyEvents, setDailyEvents] = useState([])
  const [cards, setCards] = useState([])
  const [range, setRange] = useState('30')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const client = requireSupabase()
      const [eventResult, dailyResult, cardResult] = await Promise.all([
        client.rpc('admin_analytics', { days_back: Number(range) }),
        client.rpc('admin_daily_analytics', { days_back: Number(range) }),
        client.from('digital_cards').select('id, full_name, slug, status'),
      ])
      if (!active) return
      if (eventResult.error || dailyResult.error || cardResult.error) setError(eventResult.error?.message || dailyResult.error?.message || cardResult.error?.message)
      else { setEvents(eventResult.data || []); setDailyEvents(dailyResult.data || []); setCards(cardResult.data || []); setError('') }
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [range])
  const counts = new Map()
  events.forEach((event) => counts.set(event.card_id, (counts.get(event.card_id) || 0) + Number(event.view_count)))
  const totalViews = events.reduce((total, event) => total + Number(event.view_count), 0)
  const mostViewed = [...cards].filter((card) => card.status === 'published').sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)).slice(0, 6)
  const qrVisits = events.filter((event) => event.attribution === 'qr').reduce((total, event) => total + Number(event.view_count), 0)
  const nfcVisits = events.filter((event) => event.attribution === 'nfc').reduce((total, event) => total + Number(event.view_count), 0)
  const { chartDays, dailyViews } = buildDailyViews(dailyEvents, range)
  const maxDailyViews = Math.max(1, ...dailyViews.map((day) => day.count))
  return <><PageTitle title="Analytics" subtitle="Privacy-conscious visits recorded for your published profiles." action={<select className="range-select" value={range} onChange={(event) => setRange(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>} />
    {error && <div className="form-error">{error}</div>}
    <div className="stat-grid analytics-stats">{[['Profile views', totalViews], ['QR-attributed visits', qrVisits], ['NFC-attributed visits', nfcVisits]].map(([label, count]) => <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon name={label === 'Profile views' ? 'chart' : 'qr'} size={18} /></span></div><strong>{loading ? '—' : count}</strong><small>selected period</small></div>)}</div>
    <section className="panel analytics-chart-panel"><div className="panel-heading"><div><h2>Views over time</h2><p>{chartDays} most recent days in the selected period</p></div></div>{loading ? <div className="empty-small"><span className="spinner" />Loading chart…</div> : totalViews ? <div className="daily-chart" role="img" aria-label="Daily profile views bar chart">{dailyViews.map((day) => <div className="chart-column" key={day.label} title={`${day.label}: ${day.count} views`}><span>{day.count || ''}</span><div className="chart-track"><i style={{ height: `${Math.max(day.count ? 8 : 2, (day.count / maxDailyViews) * 100)}%` }} /></div><small>{day.label}</small></div>)}</div> : <EmptyState icon="chart" title="No views in this period" body="Profile visits will appear here when visitors open a published card." />}</section>
    <section className="panel analytics-panel"><div className="panel-heading"><div><h2>Most-viewed profiles</h2><p>Views recorded within the selected period.</p></div></div>{loading ? <div className="empty-small"><span className="spinner" />Loading analytics…</div> : mostViewed.length ? <div className="table-wrap"><table><thead><tr><th>PROFILE</th><th>PUBLIC URL</th><th>VIEWS</th></tr></thead><tbody>{mostViewed.map((card) => <tr key={card.id}><td><div className="table-person"><span className="table-initial">{card.full_name.slice(0, 1)}</span><span><strong>{card.full_name}</strong></span></div></td><td>/card/{card.slug}</td><td><strong>{counts.get(card.id) || 0}</strong></td></tr>)}</tbody></table></div> : <EmptyState icon="chart" title="No profile views yet" body="Once visitors open published profiles, recorded views will appear here." />}</section>
    <p className="analytics-footnote">SynTap stores profile view events without collecting visitor identities. QR and NFC attribution is only counted when the corresponding tagged URL is used.</p>
  </>
}

function SettingsPage() {
  const { session } = useAuth()
  const [toast, setToast] = useState('')
  async function signOut() {
    const { error } = await requireSupabase().auth.signOut()
    if (error) setToast(`Could not sign out: ${error.message}`)
  }
  return <><PageTitle title="Settings" subtitle="Manage your administrator session and workspace details." /><section className="panel settings-panel"><div className="settings-section"><div><h2>Administrator account</h2><p>Your account is provisioned by a SynTap administrator. Public registration is disabled.</p></div><div className="settings-account"><span className="topbar-avatar">{session?.user?.email?.slice(0, 1).toUpperCase()}</span><span><strong>{session?.user?.email}</strong><small>Authorized administrator</small></span></div></div><div className="settings-section"><div><h2>Session</h2><p>Sign out of this device when you are finished.</p></div><button className="button button-outline" onClick={signOut}><Icon name="logout" size={17} /> Sign out</button></div><div className="settings-section"><div><h2>Public profile URL</h2><p>Profiles use this deployment's domain. Configure a custom domain in your hosting provider.</p></div><span className="settings-domain">{window.location.origin}</span></div></section><Toast message={toast} type="error" onClose={() => setToast('')} /></>
}

function LegalPage({ terms = false }) {
  return <div className="legal-page"><header className="site-nav"><Brand /><Link className="button button-outline" to="/">Back to home</Link></header><main><span className="section-kicker">SYNTAP</span><h1>{terms ? 'Terms of service' : 'Privacy policy'}</h1><p className="legal-updated">Last updated October 2026</p><p>{terms ? 'SynTap provides digital business card profiles managed by authorized administrators. Visitors may view and use published profiles but cannot edit them.' : 'SynTap is a digital business card platform. This installation stores profile information entered by its administrator and records profile view events to provide workspace analytics.'}</p><h2>{terms ? 'Using SynTap' : 'Information and analytics'}</h2><p>{terms ? 'You agree to use profiles and links lawfully. Profile owners are responsible for the accuracy of the information published on their cards.' : 'Profile details are visible to anyone who visits a published profile. SynTap analytics are first-party event counts and do not intentionally identify visitors. Profile view events may include a broad attribution label such as QR or NFC when the URL explicitly includes it.'}</p><h2>{terms ? 'Availability' : 'Data management'}</h2><p>{terms ? 'Access to the service may be changed or suspended by the installation administrator. No physical NFC tag programming is performed by the website.' : 'Administrators can edit or remove profiles. Database retention and backups are managed by the operator of the connected Supabase project.'}</p><h2>Contact</h2><p>For questions about this SynTap installation, contact its administrator.</p></main><footer className="legal-footer"><Brand /><span>© {CURRENT_YEAR} SynTap</span></footer></div>
}

function NotFoundPage() {
  return <div className="not-found"><Brand /><span className="section-kicker">PAGE NOT FOUND</span><h1>Lost your way?</h1><p>The page you’re looking for doesn’t exist or may have moved.</p><Link className="button button-yellow" to="/">Return home <Icon name="arrow" size={16} /></Link></div>
}

function RoutedApp() {
  return <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/admin/login" element={<LoginPage />} />
    <Route path="/card/:slug" element={<PublicCardPage />} />
    <Route path="/privacy" element={<LegalPage />} /><Route path="/terms" element={<LegalPage terms />} />
    <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
    <Route path="/admin/dashboard" element={<ProtectedRoute><AdminLayout><DashboardPage /></AdminLayout></ProtectedRoute>} />
    <Route path="/admin/cards" element={<ProtectedRoute><AdminLayout><CardsPage /></AdminLayout></ProtectedRoute>} />
    <Route path="/admin/cards/new" element={<ProtectedRoute><AdminLayout><CardEditorPage /></AdminLayout></ProtectedRoute>} />
    <Route path="/admin/cards/:id/edit" element={<ProtectedRoute><AdminLayout><CardEditorPage editing /></AdminLayout></ProtectedRoute>} />
    <Route path="/admin/qr-codes" element={<ProtectedRoute><AdminLayout><QrCodesPage /></AdminLayout></ProtectedRoute>} />
    <Route path="/admin/analytics" element={<ProtectedRoute><AdminLayout><AnalyticsPage /></AdminLayout></ProtectedRoute>} />
    <Route path="/admin/settings" element={<ProtectedRoute><AdminLayout><SettingsPage /></AdminLayout></ProtectedRoute>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>
}

export default function App() {
  return <BrowserRouter><AuthProvider><RoutedApp /></AuthProvider></BrowserRouter>
}
